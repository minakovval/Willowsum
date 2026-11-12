import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";
import type { HouseholdFreeDatabase } from "../../../../platform/http/route.ts";
import type { RateLimitStore } from "../../../../platform/http/rate-limit.ts";
import type {
  AccountRow,
  ConfirmationRow,
  IdentityStore,
  IdentityTx,
  RegistrationRow,
  SessionRow,
  ThrottleScope,
} from "../../application/index.ts";
import type { SignInGuard } from "../../domain/index.ts";

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

function tx(q: ModuleQueryRunner): IdentityTx {
  return {
    async findAccountByEmail(normalizedEmail) {
      const { rows } = await q.query<AccountDb>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE email_normalized = $1`,
        [normalizedEmail],
      );
      return rows[0] ? toAccount(rows[0]) : null;
    },
    async findAccount(id) {
      const { rows } = await q.query<AccountDb>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1`, [
        id,
      ]);
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
      }>(
        `SELECT id, account_id, kind, expires_at, closed_at FROM registrations WHERE token_digest = $1 FOR UPDATE`,
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
          } satisfies RegistrationRow)
        : null;
    },
    async closeRegistration(id, now) {
      await q.query(`UPDATE registrations SET closed_at = $2 WHERE id = $1 AND closed_at IS NULL`, [
        id,
        at(now),
      ]);
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
    async clearEvents(scope, key) {
      await q.query(`DELETE FROM throttle_events WHERE scope = $1 AND subject_key = $2`, [scope, key]);
    },
    async lockGuard(key) {
      await q.query(`INSERT INTO sign_in_guards (email_key) VALUES ($1) ON CONFLICT (email_key) DO NOTHING`, [
        key,
      ]);
      const { rows } = await q.query<{ locked_until: Date | null; captcha_required: boolean }>(
        `SELECT locked_until, captcha_required FROM sign_in_guards WHERE email_key = $1 FOR UPDATE`,
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
  };
}

export function databaseIdentityStore(db: HouseholdFreeDatabase): IdentityStore {
  return { transaction: (work) => db.transaction((q) => work(tx(q))) };
}

/**
 * The NFR-14 limiter's store in the identity schema (ADR-0009): counters that survive a restart and are shared
 * by every API instance. Expired windows are removed as new ones are written.
 */
export function databaseRateLimitStore(db: HouseholdFreeDatabase): RateLimitStore {
  return {
    shared: true,
    hit: (key, windowStart, windowMs) =>
      db.transaction(async (q) => {
        await q.query(`DELETE FROM rate_limit_windows WHERE key = $1 AND expires_at <= $2`, [
          key,
          at(windowStart),
        ]);
        const { rows } = await q.query<{ hits: number }>(
          `INSERT INTO rate_limit_windows (key, window_start, window_ms, hits, expires_at)
           VALUES ($1, $2, $3, 1, $4)
           ON CONFLICT (key, window_start, window_ms) DO UPDATE SET hits = rate_limit_windows.hits + 1
           RETURNING hits`,
          [key, at(windowStart), windowMs, at(windowStart + windowMs)],
        );
        return rows[0]!.hits;
      }),
  };
}
