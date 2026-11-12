import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";
import type { HouseholdFreeDatabase } from "../../../../platform/http/route.ts";
import type { FixedWindowLimiter } from "../../../../platform/http/rate-limit.ts";
import type {
  AccountRow,
  ConfirmationRow,
  IdentityStore,
  IdentityTx,
  PasswordResetRow,
  RegistrationRow,
  SessionRow,
  ThrottleScope,
} from "../../application/index.ts";
import {
  CAPTCHA_GUARD_RETENTION_MS,
  CONFIRMATION_RETENTION_MS,
  PASSWORD_RESET_RETENTION_MS,
  SESSION_IDLE_MS,
  THROTTLE_RETENTION_MS,
  type SignInGuard,
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
}

const toAccount = (r: AccountDb): AccountRow => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  passwordHash: r.password_hash,
  emailConfirmedAt: ms(r.email_confirmed_at),
});

const ACCOUNT_COLUMNS = "id, email, display_name, password_hash, email_confirmed_at";
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
        `INSERT INTO accounts (email, email_normalized, display_name, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (email_normalized) DO NOTHING
         RETURNING id`,
        [a.email, a.normalizedEmail, a.displayName, a.passwordHash, at(a.now)],
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
        `UPDATE accounts SET display_name = $2, password_hash = $3, updated_at = $4
         WHERE id = $1 AND email_confirmed_at IS NULL`,
        [accountId, account.displayName, account.passwordHash, at(now)],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async setPassword(accountId, passwordHash, now) {
      await q.query(`UPDATE accounts SET password_hash = $2, updated_at = $3 WHERE id = $1`, [
        accountId,
        passwordHash,
        at(now),
      ]);
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
        account_id: string;
        kind: "new" | "existing";
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
    async findSession(digest) {
      const { rows } = await q.query<{
        id: string;
        account_id: string;
        created_at: Date;
        last_seen_at: Date;
        expires_at: Date;
        ended_at: Date | null;
      }>(
        `SELECT id, account_id, created_at, last_seen_at, expires_at, ended_at FROM sessions WHERE token_digest = $1`,
        [digest],
      );
      const r = rows[0];
      return r
        ? ({
            id: r.id,
            accountId: r.account_id,
            createdAt: r.created_at.getTime(),
            lastSeenAt: r.last_seen_at.getTime(),
            expiresAt: r.expires_at.getTime(),
            endedAt: ms(r.ended_at),
          } satisfies SessionRow)
        : null;
    },
    async touchSession(id, now) {
      await q.query(`UPDATE sessions SET last_seen_at = GREATEST(last_seen_at, $2) WHERE id = $1`, [
        id,
        at(now),
      ]);
    },
    async endSession(id, now) {
      await q.query(`UPDATE sessions SET ended_at = $2 WHERE id = $1 AND ended_at IS NULL`, [id, at(now)]);
    },
    async endSessions(accountId, now) {
      const result = await q.query(
        `UPDATE sessions SET ended_at = $2 WHERE account_id = $1 AND ended_at IS NULL`,
        [accountId, at(now)],
      );
      return result.rowCount ?? 0;
    },
    async deleteUnconfirmedAccounts(signedUpBy, limit) {
      // updated_at of an unconfirmed account is its latest sign-up (insertAccount, replaceUnconfirmedAccount).
      // SKIP LOCKED: an account a sign-up or a confirmation holds right now is left for the next run; the outer
      // conditions are checked again on the row as it is when it is deleted. Its links, sign-up tokens, sessions
      // and reset links go with it (ON DELETE CASCADE).
      const { rows } = await q.query<{ id: string }>(
        `DELETE FROM accounts
          WHERE id IN (SELECT id FROM accounts
                        WHERE email_confirmed_at IS NULL AND updated_at <= $1
                        ORDER BY updated_at LIMIT $2 FOR UPDATE SKIP LOCKED)
            AND email_confirmed_at IS NULL AND updated_at <= $1
          RETURNING id`,
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
            WHERE (locked_until IS NULL OR locked_until <= $1)
              AND (NOT captcha_required OR changed_at <= $2)`,
          [at(now), at(now - CAPTCHA_GUARD_RETENTION_MS)],
        ),
        registrations: await count(
          `DELETE FROM registrations WHERE closed_at IS NOT NULL OR expires_at <= $1`,
          [at(now)],
        ),
        emailConfirmations: await count(
          `DELETE FROM email_confirmations
            WHERE revoked_at IS NOT NULL OR expires_at <= $1`,
          [at(now - CONFIRMATION_RETENTION_MS)],
        ),
        passwordResets: await count(`DELETE FROM password_resets WHERE created_at <= $1`, [
          at(now - PASSWORD_RESET_RETENTION_MS),
        ]),
        sessions: await count(
          `DELETE FROM sessions WHERE ended_at IS NOT NULL OR expires_at <= $1 OR last_seen_at <= $2`,
          [at(now), at(now - SESSION_IDLE_MS)],
        ),
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
