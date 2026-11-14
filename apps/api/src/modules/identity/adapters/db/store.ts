import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";
import type { HouseholdFreeDatabase } from "../../../../platform/http/route.ts";
import type { FixedWindowLimiter } from "../../../../platform/http/rate-limit.ts";
import type {
  AccountRow,
  ConfirmationRow,
  IdentityStore,
  IdentityTx,
  NotMeLinkRow,
  PasswordResetRow,
  RegistrationKind,
  RegistrationRow,
  SessionRow,
  StepUpRow,
  ThrottleScope,
} from "../../application/index.ts";
import {
  PASSWORD_RESET_RETENTION_MS,
  THROTTLE_RETENTION_MS,
  type DeviceBrowser,
  type DeviceOs,
  type SessionEndReason,
  type SignInGuard,
  type StepUpAction,
} from "../../domain/index.ts";

/** The identity schema through the module's own role (ARC-01, ARC-03; tables in migrations/0001_accounts.sql). */

const at = (ms: number): Date => new Date(ms);
const ms = (value: Date | null): number | null => (value === null ? null : value.getTime());

interface AccountDb {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  email_confirmed_at: Date | null;
  password_reset_required_at: Date | null;
  locale: string | null;
  time_zone: string | null;
}

const toAccount = (r: AccountDb): AccountRow => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  passwordHash: r.password_hash,
  emailConfirmedAt: ms(r.email_confirmed_at),
  passwordResetRequiredAt: ms(r.password_reset_required_at),
  locale: r.locale,
  timeZone: r.time_zone,
});

const ACCOUNT_COLUMNS =
  "id, email, display_name, password_hash, email_confirmed_at, password_reset_required_at, locale, time_zone";
const LOCK_CLAUSE = { share: " FOR SHARE", update: " FOR UPDATE" } as const;

interface ResetDb {
  id: string;
  account_id: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
}

function tx(q: ModuleQueryRunner): IdentityTx {
  return {
    async findAccountByEmail(normalizedEmail, lock) {
      const { rows } = await q.query<AccountDb>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE email_normalized = $1${lock ? LOCK_CLAUSE[lock] : ""}`,
        [normalizedEmail],
      );
      return rows[0] ? toAccount(rows[0]) : null;
    },
    async findAccount(id, lock) {
      const { rows } = await q.query<AccountDb>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1${lock ? LOCK_CLAUSE[lock] : ""}`,
        [id],
      );
      return rows[0] ? toAccount(rows[0]) : null;
    },
    async insertAccount(a) {
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO accounts (email, email_normalized, display_name, password_hash, locale, time_zone, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (email_normalized) DO NOTHING
         RETURNING id`,
        [a.email, a.normalizedEmail, a.displayName, a.passwordHash, a.locale, a.timeZone, at(a.now)],
      );
      return rows[0]?.id ?? null;
    },
    async confirmAccount(accountId, now) {
      const result = await q.query(
        `UPDATE accounts SET email_confirmed_at = $2, updated_at = $2
         WHERE id = $1 AND email_confirmed_at IS NULL`,
        [accountId, at(now)],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async replaceUnconfirmedAccount(accountId, account, now) {
      const result = await q.query(
        `UPDATE accounts SET display_name = $2, password_hash = $3, locale = $4, time_zone = $5, updated_at = $6
         WHERE id = $1 AND email_confirmed_at IS NULL`,
        [accountId, account.displayName, account.passwordHash, account.locale, account.timeZone, at(now)],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async setDisplayName(accountId, displayName, now) {
      const result = await q.query(`UPDATE accounts SET display_name = $2, updated_at = $3 WHERE id = $1`, [
        accountId,
        displayName,
        at(now),
      ]);
      return (result.rowCount ?? 0) > 0;
    },
    async setPassword(accountId, passwordHash, now) {
      await q.query(
        `UPDATE accounts SET password_hash = $2, password_reset_required_at = NULL, updated_at = $3 WHERE id = $1`,
        [accountId, passwordHash, at(now)],
      );
    },
    async requirePasswordReset(accountId, now) {
      await q.query(
        `UPDATE accounts SET password_reset_required_at = COALESCE(password_reset_required_at, $2), updated_at = $2
         WHERE id = $1`,
        [accountId, at(now)],
      );
    },
    async rememberDevice(accountId, deviceDigest, now) {
      // One sign-in of the account at a time decides «first» / «new» (two first sign-ins at once: one is first).
      await q.query(`SELECT pg_advisory_xact_lock(hashtext('identity:devices'), hashtext($1::text))`, [
        accountId,
      ]);
      const { rows } = await q.query<{ known: boolean; any: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM sign_in_devices WHERE account_id = $1 AND device_digest = $2) AS known,
                EXISTS (SELECT 1 FROM sign_in_devices WHERE account_id = $1) AS any`,
        [accountId, deviceDigest],
      );
      const { known, any } = rows[0]!;
      await q.query(
        `INSERT INTO sign_in_devices (account_id, device_digest, first_seen_at, last_seen_at) VALUES ($1, $2, $3, $3)
         ON CONFLICT (account_id, device_digest) DO UPDATE SET last_seen_at = GREATEST(sign_in_devices.last_seen_at, EXCLUDED.last_seen_at)`,
        [accountId, deviceDigest, at(now)],
      );
      return known ? "known" : any ? "new" : "first";
    },
    async forgetDevice(accountId, deviceDigest) {
      await q.query(`DELETE FROM sign_in_devices WHERE account_id = $1 AND device_digest = $2`, [
        accountId,
        deviceDigest,
      ]);
    },
    async insertNotMeLink(link) {
      await q.query(
        `INSERT INTO not_me_links (account_id, token_digest, device_digest, signed_in_at, device_browser, device_os,
                                   address_masked, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $4, $8)`,
        [
          link.accountId,
          link.tokenDigest,
          link.deviceDigest,
          at(link.signedInAt),
          link.device.browser,
          link.device.os,
          link.addressMasked,
          at(link.expiresAt),
        ],
      );
    },
    async findNotMeLink(digest, lock) {
      const { rows } = await q.query<{
        id: string;
        account_id: string;
        device_digest: Buffer;
        signed_in_at: Date;
        device_browser: DeviceBrowser;
        device_os: DeviceOs;
        address_masked: string;
        expires_at: Date;
        used_at: Date | null;
      }>(
        `SELECT id, account_id, device_digest, signed_in_at, device_browser, device_os, address_masked, expires_at, used_at
           FROM not_me_links WHERE token_digest = $1${lock ? " FOR UPDATE" : ""}`,
        [digest],
      );
      const r = rows[0];
      return r
        ? ({
            id: r.id,
            accountId: r.account_id,
            deviceDigest: r.device_digest,
            signedInAt: r.signed_in_at.getTime(),
            device: { browser: r.device_browser, os: r.device_os },
            addressMasked: r.address_masked,
            expiresAt: r.expires_at.getTime(),
            usedAt: ms(r.used_at),
          } satisfies NotMeLinkRow)
        : null;
    },
    async useNotMeLink(id, now) {
      await q.query(`UPDATE not_me_links SET used_at = $2 WHERE id = $1 AND used_at IS NULL`, [id, at(now)]);
    },
    async insertConfirmation(accountId, digest, now, expiresAt) {
      await q.query(
        `INSERT INTO email_confirmations (account_id, token_digest, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
        [accountId, digest, at(now), at(expiresAt)],
      );
    },
    async revokeConfirmations(accountId, now) {
      await q.query(
        `UPDATE email_confirmations SET revoked_at = $2
         WHERE account_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
        [accountId, at(now)],
      );
    },
    async findConfirmation(digest) {
      const { rows } = await q.query<{
        id: string;
        account_id: string;
        expires_at: Date;
        used_at: Date | null;
        revoked_at: Date | null;
      }>(
        `SELECT id, account_id, expires_at, used_at, revoked_at FROM email_confirmations WHERE token_digest = $1 FOR UPDATE`,
        [digest],
      );
      const r = rows[0];
      return r
        ? ({
            id: r.id,
            accountId: r.account_id,
            expiresAt: r.expires_at.getTime(),
            usedAt: ms(r.used_at),
            revokedAt: ms(r.revoked_at),
          } satisfies ConfirmationRow)
        : null;
    },
    async useConfirmation(id, now) {
      await q.query(`UPDATE email_confirmations SET used_at = $2 WHERE id = $1 AND used_at IS NULL`, [
        id,
        at(now),
      ]);
    },
    async insertRegistration(accountId, kind, digest, now, expiresAt) {
      await q.query(
        `INSERT INTO registrations (account_id, kind, token_digest, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)`,
        [accountId, kind, digest, at(now), at(expiresAt)],
      );
    },
    async findRegistration(digest) {
      const { rows } = await q.query<{
        id: string;
        account_id: string | null;
        kind: RegistrationKind;
        expires_at: Date;
        closed_at: Date | null;
        superseded_at: Date | null;
      }>(
        `SELECT id, account_id, kind, expires_at, closed_at, superseded_at FROM registrations
         WHERE token_digest = $1 FOR UPDATE`,
        [digest],
      );
      const r = rows[0];
      return r
        ? ({
            id: r.id,
            accountId: r.account_id,
            kind: r.kind,
            expiresAt: r.expires_at.getTime(),
            closedAt: ms(r.closed_at),
            supersededAt: ms(r.superseded_at),
          } satisfies RegistrationRow)
        : null;
    },
    async closeRegistration(id, now) {
      await q.query(`UPDATE registrations SET closed_at = $2 WHERE id = $1 AND closed_at IS NULL`, [
        id,
        at(now),
      ]);
    },
    async supersedeRegistrations(accountId, now) {
      await q.query(
        `UPDATE registrations SET superseded_at = $2
         WHERE account_id = $1 AND closed_at IS NULL AND superseded_at IS NULL`,
        [accountId, at(now)],
      );
    },
    async insertPasswordReset(accountId, digest, now, expiresAt) {
      await q.query(
        `INSERT INTO password_resets (account_id, token_digest, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
        [accountId, digest, at(now), at(expiresAt)],
      );
    },
    async revokePasswordResets(accountId, now) {
      await q.query(
        `UPDATE password_resets SET revoked_at = $2
         WHERE account_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
        [accountId, at(now)],
      );
    },
    async findPasswordReset(digest, lock) {
      const { rows } = await q.query<ResetDb>(
        `SELECT id, account_id, created_at, expires_at, used_at, revoked_at FROM password_resets
         WHERE token_digest = $1${lock ? " FOR UPDATE" : ""}`,
        [digest],
      );
      const r = rows[0];
      return r
        ? ({
            id: r.id,
            accountId: r.account_id,
            createdAt: r.created_at.getTime(),
            expiresAt: r.expires_at.getTime(),
            usedAt: ms(r.used_at),
            revokedAt: ms(r.revoked_at),
          } satisfies PasswordResetRow)
        : null;
    },
    async usePasswordReset(id, now) {
      await q.query(`UPDATE password_resets SET used_at = $2 WHERE id = $1 AND used_at IS NULL`, [
        id,
        at(now),
      ]);
    },
    async passwordResetTimes(accountId, since) {
      const { rows } = await q.query<{ created_at: Date }>(
        `SELECT created_at FROM password_resets WHERE account_id = $1 AND created_at > $2 ORDER BY created_at`,
        [accountId, at(since)],
      );
      return rows.map((r) => r.created_at.getTime());
    },
    async eventTimes(scope: ThrottleScope, key, since) {
      const { rows } = await q.query<{ occurred_at: Date }>(
        `SELECT occurred_at FROM throttle_events
         WHERE scope = $1 AND subject_key = $2 AND occurred_at > $3 ORDER BY occurred_at`,
        [scope, key, at(since)],
      );
      return rows.map((r) => r.occurred_at.getTime());
    },
    async addEvent(scope, key, when) {
      await q.query(`INSERT INTO throttle_events (scope, subject_key, occurred_at) VALUES ($1, $2, $3)`, [
        scope,
        key,
        at(when),
      ]);
    },
    async lockSubject(scope, key) {
      await q.query(
        `SELECT pg_advisory_xact_lock(hashtext('identity:' || $1::text), hashtext(encode($2, 'hex')))`,
        [scope, key],
      );
    },
    async clearEvents(scope, key) {
      await q.query(`DELETE FROM throttle_events WHERE scope = $1 AND subject_key = $2`, [scope, key]);
    },
    async lockGuard(key) {
      // One statement creates or locks the row: the daily task may delete an idle guard at any moment, and an
      // insert followed by a separate SELECT … FOR UPDATE would then find no row.
      const { rows } = await q.query<{ locked_until: Date | null; captcha_required: boolean }>(
        `INSERT INTO sign_in_guards (email_key) VALUES ($1)
         ON CONFLICT (email_key) DO UPDATE SET email_key = EXCLUDED.email_key
         RETURNING locked_until, captcha_required`,
        [key],
      );
      const r = rows[0]!;
      return { lockedUntil: ms(r.locked_until), captchaRequired: r.captcha_required };
    },
    async readGuard(key) {
      const { rows } = await q.query<{ locked_until: Date | null; captcha_required: boolean }>(
        `SELECT locked_until, captcha_required FROM sign_in_guards WHERE email_key = $1`,
        [key],
      );
      const r = rows[0];
      return r
        ? ({ lockedUntil: ms(r.locked_until), captchaRequired: r.captcha_required } satisfies SignInGuard)
        : null;
    },
    async setGuard(key, guard, now) {
      await q.query(
        `INSERT INTO sign_in_guards (email_key, locked_until, captcha_required, changed_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email_key) DO UPDATE
           SET locked_until = EXCLUDED.locked_until, captcha_required = EXCLUDED.captcha_required,
               changed_at = EXCLUDED.changed_at`,
        [key, guard.lockedUntil === null ? null : at(guard.lockedUntil), guard.captchaRequired, at(now)],
      );
    },
    async insertSession(accountId, digest, now, expiresAt) {
      await q.query(
        `INSERT INTO sessions (account_id, token_digest, created_at, last_seen_at, expires_at) VALUES ($1, $2, $3, $3, $4)`,
        [accountId, digest, at(now), at(expiresAt)],
      );
    },
    async findSession(digest, lock) {
      const columns = `s.id, s.account_id, s.created_at, s.last_seen_at, s.expires_at, s.ended_at, s.end_reason`;
      const suffix = lock ? " FOR UPDATE OF s" : "";
      type Row = {
        id: string;
        account_id: string;
        created_at: Date;
        last_seen_at: Date;
        expires_at: Date;
        ended_at: Date | null;
        end_reason: SessionEndReason | null;
        retired_at: Date | null;
      };
      let { rows } = await q.query<Row>(
        `SELECT ${columns}, NULL::timestamptz AS retired_at FROM sessions s WHERE s.token_digest = $1${suffix}`,
        [digest],
      );
      if (rows.length === 0)
        ({ rows } = await q.query<Row>(
          `SELECT ${columns}, r.retired_at FROM retired_session_tokens r JOIN sessions s ON s.id = r.session_id
            WHERE r.token_digest = $1${suffix}`,
          [digest],
        ));
      const r = rows[0];
      return r
        ? ({
            id: r.id,
            accountId: r.account_id,
            createdAt: r.created_at.getTime(),
            lastSeenAt: r.last_seen_at.getTime(),
            expiresAt: r.expires_at.getTime(),
            endedAt: ms(r.ended_at),
            endReason: r.end_reason,
            retiredAt: ms(r.retired_at),
          } satisfies SessionRow)
        : null;
    },
    async touchSession(id, now) {
      await q.query(`UPDATE sessions SET last_seen_at = GREATEST(last_seen_at, $2) WHERE id = $1`, [
        id,
        at(now),
      ]);
    },
    async rotateSession(id, next, now) {
      await q.query(
        `INSERT INTO retired_session_tokens (token_digest, session_id, retired_at)
         SELECT token_digest, id, $2 FROM sessions WHERE id = $1`,
        [id, at(now)],
      );
      await q.query(`UPDATE sessions SET token_digest = $2 WHERE id = $1`, [id, next]);
    },
    async endSession(id, now, reason) {
      await q.query(`UPDATE sessions SET ended_at = $2, end_reason = $3 WHERE id = $1 AND ended_at IS NULL`, [
        id,
        at(now),
        reason,
      ]);
    },
    async endSessions(accountId, now, reason) {
      const result = await q.query(
        `UPDATE sessions SET ended_at = $2, end_reason = $3 WHERE account_id = $1 AND ended_at IS NULL`,
        [accountId, at(now), reason],
      );
      return result.rowCount ?? 0;
    },
    async endOtherSessions(accountId, keep, now, reason) {
      const result = await q.query(
        `UPDATE sessions SET ended_at = $3, end_reason = $4 WHERE account_id = $1 AND id <> $2 AND ended_at IS NULL`,
        [accountId, keep, at(now), reason],
      );
      return result.rowCount ?? 0;
    },
    async insertStepUp(c) {
      await q.query(`DELETE FROM step_up_confirmations WHERE session_id = $1 AND action = $2`, [
        c.sessionId,
        c.action,
      ]);
      await q.query(
        `INSERT INTO step_up_confirmations (session_id, action, token_digest, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [c.sessionId, c.action, c.tokenDigest, at(c.now), at(c.expiresAt)],
      );
    },
    async findStepUp(digest, lock) {
      const { rows } = await q.query<{
        id: string;
        session_id: string;
        action: StepUpAction;
        expires_at: Date;
        used_at: Date | null;
      }>(
        `SELECT id, session_id, action, expires_at, used_at FROM step_up_confirmations
         WHERE token_digest = $1${lock ? " FOR UPDATE" : ""}`,
        [digest],
      );
      const r = rows[0];
      return r
        ? ({
            id: r.id,
            sessionId: r.session_id,
            action: r.action,
            expiresAt: r.expires_at.getTime(),
            usedAt: ms(r.used_at),
          } satisfies StepUpRow)
        : null;
    },
    async useStepUp(id, now) {
      await q.query(`UPDATE step_up_confirmations SET used_at = $2 WHERE id = $1 AND used_at IS NULL`, [
        id,
        at(now),
      ]);
    },
    async deleteUnconfirmedAccounts(signedUpBy, limit) {
      // updated_at of an unconfirmed account is its latest sign-up (insertAccount, replaceUnconfirmedAccount).
      // SKIP LOCKED: an account a sign-up or a confirmation holds right now is left for the next run; the outer
      // conditions are checked again on the row as it is when it is deleted. Its links, sign-up tokens, sessions
      // and reset links go with it (ON DELETE CASCADE).
      // A CTE with a locking clause runs once: an IN (…) subquery may be rescanned and exceed the LIMIT.
      const { rows } = await q.query<{ id: string }>(
        `WITH batch AS (SELECT id FROM accounts
                         WHERE email_confirmed_at IS NULL AND updated_at <= $1
                         ORDER BY updated_at LIMIT $2 FOR UPDATE SKIP LOCKED)
         DELETE FROM accounts a USING batch b
          WHERE a.id = b.id AND a.email_confirmed_at IS NULL AND a.updated_at <= $1
          RETURNING a.id`,
        [at(signedUpBy), limit],
      );
      return rows.map((r) => r.id);
    },
    async sweep(now) {
      const count = async (sql: string, values: unknown[]) => (await q.query(sql, values)).rowCount ?? 0;
      return {
        throttleEvents: await count(`DELETE FROM throttle_events WHERE occurred_at <= $1`, [
          at(now - THROTTLE_RETENTION_MS),
        ]),
        signInGuards: await count(
          `DELETE FROM sign_in_guards
            WHERE NOT captcha_required AND (locked_until IS NULL OR locked_until <= $1)`,
          [at(now)],
        ),
        registrations: await count(
          `DELETE FROM registrations WHERE closed_at IS NOT NULL OR expires_at <= $1`,
          [at(now)],
        ),
        // Used and expired links keep answering (AC24, AC6); they go with their account.
        emailConfirmations: await count(`DELETE FROM email_confirmations WHERE revoked_at IS NOT NULL`, []),
        passwordResets: await count(`DELETE FROM password_resets WHERE created_at <= $1`, [
          at(now - PASSWORD_RESET_RETENTION_MS),
        ]),
        // An ended or lapsed session still answers SESSION_ENDED with its reason (ACC-04@PoC AC1: «через
        // бездіяльність», «з іншого пристрою») while its browser may hold the cookie: up to the absolute end, when the
        // cookie's Max-Age runs out. Its replaced tokens go with it (cascade).
        sessions: await count(`DELETE FROM sessions WHERE expires_at <= $1`, [at(now)]),
        // A used or expired «Це був не я» link answers «Посилання недійсне», as an unknown one does.
        notMeLinks: await count(`DELETE FROM not_me_links WHERE used_at IS NOT NULL OR expires_at <= $1`, [
          at(now),
        ]),
      };
    },
  };
}

export function databaseIdentityStore(db: HouseholdFreeDatabase): IdentityStore {
  return { transaction: (work) => db.transaction((q) => work(tx(q))) };
}

/**
 * Sign-ups per client address as a sliding window over `throttle_events` (ACC-01 AC12: «за останню годину»; ADR-0009):
 * a fixed clock-hour window would let 10 through around the hour boundary. Same interface as the NFR-14 limiter
 * primitive; the key is `<name>:<sha-256 hex>`, serialised per key with a transaction-scoped advisory lock.
 */
export function databaseSlidingLimiter(
  db: HouseholdFreeDatabase,
  options: { readonly limit: number; readonly windowMs: number; readonly now: () => number },
): FixedWindowLimiter {
  const { limit, windowMs } = options;
  return {
    limit,
    windowMs,
    hit: (key) =>
      db.transaction(async (q) => {
        await q.query(`SELECT pg_advisory_xact_lock(hashtext('identity:sign-up'), hashtext($1))`, [key]);
        const subject = Buffer.from(key.slice(key.indexOf(":") + 1), "hex");
        const now = options.now();
        const { rows } = await q.query<{ occurred_at: Date }>(
          `SELECT occurred_at FROM throttle_events
           WHERE scope = 'sign-up' AND subject_key = $1 AND occurred_at > $2 ORDER BY occurred_at`,
          [subject, at(now - windowMs)],
        );
        if (rows.length >= limit) {
          const oldest = rows[rows.length - limit]!.occurred_at.getTime();
          return {
            allowed: false,
            count: rows.length + 1,
            limit,
            retryAfterS: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
          };
        }
        await q.query(
          `INSERT INTO throttle_events (scope, subject_key, occurred_at) VALUES ('sign-up', $1, $2)`,
          [subject, at(now)],
        );
        return { allowed: true, count: rows.length + 1, limit, retryAfterS: 1 };
      }),
  };
}
