import { exchangeRate, Money } from "@willowsum/domain-kernel";
import type { HouseholdQueryRunner, ModuleDatabase } from "../../../../platform/db/module-db.ts";
import type {
  Entry,
  IntegrityAlertStore,
  IntegrityFindings,
  LedgerAccount,
  LedgerStore,
  LedgerTx,
} from "../../application/index.ts";
import { publishEvent } from "../../../../platform/queue/index.ts";
import { LedgerError, SERVICE_ACCOUNTS } from "../../domain/index.ts";
import { entryRecorded } from "../../events.ts";

/** The ledger schema through the module's own role (FIN-04, ARC-11; tables in migrations/0001_journal.sql). */

interface EntryRow {
  id: string;
  source_module: string;
  source_id: string;
  event_type: string;
  operation_date: string;
  recorded_at: string;
  rules_version: number;
  reverses_entry_id: string | null;
}

const ENTRY_COLUMNS = `id, source_module, source_id, event_type, operation_date::text AS operation_date,
  to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at, rules_version,
  reverses_entry_id`;

const ACCOUNT_COLUMNS = "id, type, currency";

/**
 * The daily integrity check (FIN-04 FR 9, AC7) per space. A posting carries one positive amount for both sides (row
 * constraints), so an entry is unbalanced in a currency exactly when a posting's account is not in the posting's
 * currency — which the keys forbid, but a restore or a dropped key could let in.
 */
const INTEGRITY = `
  WITH legs AS (
    SELECT entry_id, debit_account_id AS account_id, amount AS signed FROM postings WHERE household_id = $1
    UNION ALL
    SELECT entry_id, credit_account_id, -amount FROM postings WHERE household_id = $1),
  per_account AS (SELECT entry_id, account_id, sum(signed) AS net FROM legs GROUP BY 1, 2),
  -- The balance cache (migrations/0006_balance_cache.sql) of every cached account against its postings: a row for
  -- each day with postings, each row the totals up to its day, and the latest time of recording of its entries.
  moves AS (
    SELECT side.account_id, e.operation_date AS day, sum(side.debit) AS debits, sum(side.credit) AS credits,
           max(e.recorded_at) AS recorded
      FROM postings p JOIN entries e ON e.household_id = p.household_id AND e.id = p.entry_id
      CROSS JOIN LATERAL (VALUES (p.debit_account_id, p.amount, 0::numeric), (p.credit_account_id, 0::numeric, p.amount))
        AS side(account_id, debit, credit)
     WHERE p.household_id = $1
     GROUP BY 1, 2),
  cached AS (SELECT account_id, day, debits, credits FROM daily_balances WHERE household_id = $1),
  days AS (SELECT account_id, day FROM moves UNION SELECT account_id, day FROM cached),
  expected AS (
    SELECT d.account_id, d.day,
           sum(coalesce(m.debits, 0)) OVER w AS debits, sum(coalesce(m.credits, 0)) OVER w AS credits
      FROM days d LEFT JOIN moves m USING (account_id, day)
    WINDOW w AS (PARTITION BY d.account_id ORDER BY d.day))
  SELECT
    (SELECT count(DISTINCT p.entry_id) FROM postings p WHERE p.household_id = $1 AND EXISTS (
        SELECT 1 FROM (VALUES (p.debit_account_id), (p.credit_account_id)) AS side(account_id)
         WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.household_id = p.household_id
                             AND a.id = side.account_id AND a.currency = p.currency)))::int
      AS unbalanced_entry,
    (SELECT count(*) FROM entries e WHERE e.household_id = $1
        AND NOT EXISTS (SELECT 1 FROM postings p WHERE p.household_id = e.household_id AND p.entry_id = e.id))::int
      AS empty_entry,
    (SELECT count(*) FROM entries r WHERE r.household_id = $1 AND r.reverses_entry_id IS NOT NULL AND (
        NOT EXISTS (SELECT 1 FROM entries o WHERE o.household_id = r.household_id AND o.id = r.reverses_entry_id
                      AND o.reverses_entry_id IS NULL AND o.operation_date = r.operation_date)
        OR EXISTS (SELECT 1 FROM per_account n WHERE n.entry_id IN (r.id, r.reverses_entry_id)
                    GROUP BY n.account_id HAVING sum(n.net) <> 0)))::int
      AS reversal_mismatch,
    (SELECT count(*) FROM balance_versions v WHERE v.household_id = $1 AND (
        v.last_recorded_at IS DISTINCT FROM (SELECT max(m.recorded) FROM moves m WHERE m.account_id = v.account_id)
        OR EXISTS (SELECT 1 FROM expected x LEFT JOIN cached c USING (account_id, day)
                    WHERE x.account_id = v.account_id
                      AND (c.day IS NULL OR c.debits <> x.debits OR c.credits <> x.credits))))::int
      AS balance_cache`;

/**
 * Taken after an account's first cache (its version row) is made or its cache rebuilt, before the postings are read,
 * and held to commit: a posting that skips the cache (an older code version, a direct INSERT) and commits meanwhile
 * waits in the commit-time trigger (migrations/0006_balance_cache.sql), so it is either read from the postings here
 * or refused there.
 */
async function lockBalanceCreation(q: HouseholdQueryRunner, accountId: string): Promise<void> {
  await q.query(
    `SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext($1::uuid::text), pg_catalog.hashtext($2::uuid::text))`,
    [q.householdId, accountId],
  );
}

/**
 * Writes an account's cache from its postings (the version row is already locked by this transaction): every day with
 * postings gets the totals up to it, and the version row the latest time of recording. The number of days written.
 */
async function rebuildDays(q: HouseholdQueryRunner, accountId: string): Promise<number> {
  await q.query(`DELETE FROM daily_balances WHERE household_id = $1 AND account_id = $2`, [
    q.householdId,
    accountId,
  ]);
  const { rowCount } = await q.query(
    `INSERT INTO daily_balances (household_id, account_id, day, currency, debits, credits)
     SELECT a.household_id, a.id, m.day, a.currency,
            sum(m.debits) OVER (ORDER BY m.day), sum(m.credits) OVER (ORDER BY m.day)
       FROM accounts a
       JOIN (SELECT e.operation_date AS day,
                    coalesce(sum(p.amount) FILTER (WHERE p.debit_account_id = $2), 0) AS debits,
                    coalesce(sum(p.amount) FILTER (WHERE p.credit_account_id = $2), 0) AS credits
               FROM postings p JOIN entries e ON e.household_id = p.household_id AND e.id = p.entry_id
              WHERE p.household_id = $1 AND (p.debit_account_id = $2 OR p.credit_account_id = $2)
              GROUP BY e.operation_date) m ON true
      WHERE a.household_id = $1 AND a.id = $2`,
    [q.householdId, accountId],
  );
  await q.query(
    `UPDATE balance_versions SET changed_at = now(), last_recorded_at = (
       SELECT max(e.recorded_at) FROM postings p JOIN entries e ON e.household_id = p.household_id AND e.id = p.entry_id
        WHERE p.household_id = $1 AND (p.debit_account_id = $2 OR p.credit_account_id = $2))
      WHERE household_id = $1 AND account_id = $2`,
    [q.householdId, accountId],
  );
  return rowCount ?? 0;
}

function tx(q: HouseholdQueryRunner): LedgerTx {
  const entries = async (where: string, value: string): Promise<Entry | null> => {
    const { rows } = await q.query<EntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM entries WHERE household_id = $1 AND ${where} = $2`,
      [q.householdId, value],
    );
    const row = rows[0];
    if (!row) return null;
    const postings = await q.query<{
      debit_account_id: string;
      credit_account_id: string;
      amount: string;
      currency: string;
    }>(
      `SELECT debit_account_id, credit_account_id, amount::text AS amount, currency FROM postings
        WHERE household_id = $1 AND entry_id = $2 ORDER BY seq`,
      [q.householdId, row.id],
    );
    const conversions = await q.query<{
      currency: string;
      amount: string;
      entry_currency: string;
      entry_amount: string;
      rate: string;
      rate_date: string;
      rate_source: string;
      converted: string;
    }>(
      `SELECT currency, amount::text AS amount, entry_currency, entry_amount::text AS entry_amount, rate::text AS rate,
              rate_date::text AS rate_date, rate_source, converted::text AS converted
         FROM conversions WHERE household_id = $1 AND entry_id = $2 ORDER BY seq`,
      [q.householdId, row.id],
    );
    return {
      id: row.id,
      source: { module: row.source_module, id: row.source_id },
      eventType: row.event_type,
      operationDate: row.operation_date,
      recordedAt: row.recorded_at,
      rulesVersion: row.rules_version,
      reversesEntryId: row.reverses_entry_id,
      postings: postings.rows.map((p) => ({
        debitAccountId: p.debit_account_id,
        creditAccountId: p.credit_account_id,
        amount: Money.of(p.amount, p.currency),
      })),
      conversions: conversions.rows.map((c) => ({
        amount: Money.of(c.amount, c.currency),
        entryAmount: Money.of(c.entry_amount, c.entry_currency),
        converted: Money.of(c.converted, c.entry_currency),
        rate: exchangeRate({
          base: c.currency,
          quote: c.entry_currency,
          rate: c.rate,
          date: c.rate_date,
          source: c.rate_source,
        }),
      })),
    };
  };

  return {
    async accounts(ids) {
      if (ids.length === 0) return [];
      const { rows } = await q.query<LedgerAccount>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE household_id = $1 AND id = ANY($2::uuid[])`,
        [q.householdId, ids],
      );
      return rows;
    },
    async ensureServiceAccount(kind, currency, newId) {
      await q.query(
        `INSERT INTO accounts (household_id, id, type, currency, service_kind) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (household_id, service_kind, currency) DO NOTHING`,
        [q.householdId, newId, SERVICE_ACCOUNTS[kind], currency, kind],
      );
      const { rows } = await q.query<LedgerAccount>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE household_id = $1 AND service_kind = $2 AND currency = $3`,
        [q.householdId, kind, currency],
      );
      return rows[0]!;
    },
    async ensureOwnedAccount(owner, account, newId) {
      await q.query(
        `INSERT INTO accounts (household_id, id, type, currency, owner_module, owner_id) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (household_id, owner_module, owner_id) DO NOTHING`,
        [q.householdId, newId, account.type, account.currency, owner.module, owner.id],
      );
      const { rows } = await q.query<LedgerAccount>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE household_id = $1 AND owner_module = $2 AND owner_id = $3`,
        [q.householdId, owner.module, owner.id],
      );
      return rows[0]!;
    },
    entry: (id) => entries("id", id),
    entryByKey: (key) => entries("idempotency_key", key),
    async reversalOf(entryId) {
      const { rows } = await q.query<{ id: string }>(
        `SELECT id FROM entries WHERE household_id = $1 AND reverses_entry_id = $2`,
        [q.householdId, entryId],
      );
      return rows[0]?.id ?? null;
    },
    async insertEntry(e) {
      try {
        const { rowCount } = await q.query(
          `INSERT INTO entries (household_id, id, source_module, source_id, event_type, operation_date, rules_version,
             idempotency_key, reverses_entry_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (household_id, idempotency_key) DO NOTHING`,
          [
            q.householdId,
            e.id,
            e.source.module,
            e.source.id,
            e.eventType,
            e.operationDate,
            e.rulesVersion,
            e.idempotencyKey,
            e.reversesEntryId,
          ],
        );
        return rowCount === 1;
      } catch (error) {
        // A concurrent reversal of the same entry won the unique key: the entry is reversed once only.
        if ((error as { constraint?: string }).constraint === "entries_household_id_reverses_entry_id_key")
          throw new LedgerError("ALREADY_REVERSED", "This entry has already been reversed");
        throw error;
      }
    },
    async insertPostings(entryId, postings) {
      // One statement for the whole set: it is written completely or not at all.
      await q.query(
        `INSERT INTO postings (household_id, entry_id, seq, debit_account_id, credit_account_id, amount, currency)
         SELECT $1, $2, s.seq, s.debit, s.credit, s.amount, s.currency
           FROM unnest($3::smallint[], $4::uuid[], $5::uuid[], $6::numeric[], $7::text[])
             AS s(seq, debit, credit, amount, currency)`,
        [
          q.householdId,
          entryId,
          postings.map((_, i) => i + 1),
          postings.map((p) => p.debitAccountId),
          postings.map((p) => p.creditAccountId),
          postings.map((p) => p.amount.toDecimalString()),
          postings.map((p) => p.amount.currency),
        ],
      );
    },
    async insertConversions(entryId, conversions) {
      // The rate as its exact decimal text (never a float); the database checks converted = amount × rate.
      await q.query(
        `INSERT INTO conversions (household_id, entry_id, seq, currency, amount, entry_currency, entry_amount, rate,
           rate_date, rate_source, converted)
         SELECT $1, $2, s.seq, s.currency, s.amount, s.entry_currency, s.entry_amount, s.rate, s.rate_date,
                s.rate_source, s.converted
           FROM unnest($3::smallint[], $4::text[], $5::numeric[], $6::text[], $7::numeric[], $8::numeric[], $9::date[],
                       $10::text[], $11::numeric[])
             AS s(seq, currency, amount, entry_currency, entry_amount, rate, rate_date, rate_source, converted)`,
        [
          q.householdId,
          entryId,
          conversions.map((_, i) => i + 1),
          conversions.map((c) => c.amount.currency),
          conversions.map((c) => c.amount.toDecimalString()),
          conversions.map((c) => c.entryAmount.currency),
          conversions.map((c) => c.entryAmount.toDecimalString()),
          conversions.map((c) => c.rate.rate.toFixed()),
          conversions.map((c) => c.rate.date),
          conversions.map((c) => c.rate.source),
          conversions.map((c) => c.converted.toDecimalString()),
        ],
      );
    },
    async recorded(entry) {
      // The outbox row commits or rolls back with the entry (ARC-04 FR 2; migrations/0004_outbox.sql).
      await publishEvent(q, entryRecorded, {
        entryId: entry.id,
        sourceModule: entry.source.module,
        sourceId: entry.source.id,
        eventType: entry.eventType,
        operationDate: entry.operationDate,
        recordedAt: entry.recordedAt,
        reversesEntryId: entry.reversesEntryId,
      });
    },
    async totals(accountId, date, asKnownAt) {
      const { rows } = await q.query<{ debits: string; credits: string }>(
        `SELECT coalesce(sum(p.amount) FILTER (WHERE p.debit_account_id = $2), 0)::text AS debits,
                coalesce(sum(p.amount) FILTER (WHERE p.credit_account_id = $2), 0)::text AS credits
           FROM postings p JOIN entries e ON e.household_id = p.household_id AND e.id = p.entry_id
          WHERE p.household_id = $1 AND (p.debit_account_id = $2 OR p.credit_account_id = $2)
            AND e.operation_date <= $3::date AND ($4::timestamptz IS NULL OR e.recorded_at <= $4::timestamptz)`,
        [q.householdId, accountId, date, asKnownAt],
      );
      return rows[0]!;
    },
    async cachedTotals(accountId, date, asKnownAt) {
      // One statement, so the version row and the day row are read from one snapshot.
      const { rows } = await q.query<{ servable: boolean; debits: string; credits: string }>(
        `SELECT ($4::timestamptz IS NULL OR v.last_recorded_at IS NULL OR v.last_recorded_at <= $4::timestamptz)
                  AS servable,
                coalesce(d.debits, 0)::text AS debits, coalesce(d.credits, 0)::text AS credits
           FROM balance_versions v
           LEFT JOIN LATERAL (
             SELECT debits, credits FROM daily_balances b
              WHERE b.household_id = v.household_id AND b.account_id = v.account_id AND b.day <= $3::date
              ORDER BY b.day DESC LIMIT 1) d ON true
          WHERE v.household_id = $1 AND v.account_id = $2`,
        [q.householdId, accountId, date, asKnownAt],
      );
      const row = rows[0];
      return row?.servable ? { debits: row.debits, credits: row.credits } : null;
    },
    async balanceVersion(accountId) {
      const { rows } = await q.query<{ version: string }>(
        `SELECT version::text AS version FROM balance_versions WHERE household_id = $1 AND account_id = $2`,
        [q.householdId, accountId],
      );
      return rows[0] ? Number(rows[0].version) : null;
    },
    async moveBalance(accountId, expected, day, debits, credits) {
      if (expected === null) {
        // The first cache of the account: whoever inserts the version row builds it from the postings; another
        // transaction's insert of the same row waits for this one and then sees a conflict.
        const made = await q.query(
          `INSERT INTO balance_versions (household_id, account_id, version) VALUES ($1, $2, 1)
           ON CONFLICT (household_id, account_id) DO NOTHING`,
          [q.householdId, accountId],
        );
        if (made.rowCount !== 1) return false;
        // Only the winner takes the lock, after the version row: a loser holding it to commit while it waits for the
        // winner's row would deadlock with a posting that waits for the lock in the trigger.
        await lockBalanceCreation(q, accountId);
        await rebuildDays(q, accountId);
        return true;
      }
      // The version check: the row lock makes concurrent updates of the account wait; once the first commits, the
      // others find a new version and retry on the fresh cache.
      const bumped = await q.query(
        `UPDATE balance_versions
            SET version = version + 1, changed_at = now(),
                last_recorded_at = greatest(last_recorded_at, now())
          WHERE household_id = $1 AND account_id = $2 AND version = $3`,
        [q.householdId, accountId, String(expected)],
      );
      if (bumped.rowCount !== 1) return false;
      // The day's row starts from the latest earlier day; then the day and every later day get the movement.
      await q.query(
        `INSERT INTO daily_balances (household_id, account_id, day, currency, debits, credits)
         SELECT a.household_id, a.id, $3::date, a.currency, coalesce(prev.debits, 0), coalesce(prev.credits, 0)
           FROM accounts a
           LEFT JOIN LATERAL (
             SELECT debits, credits FROM daily_balances b
              WHERE b.household_id = a.household_id AND b.account_id = a.id AND b.day < $3::date
              ORDER BY b.day DESC LIMIT 1) prev ON true
          WHERE a.household_id = $1 AND a.id = $2
         ON CONFLICT (household_id, account_id, day) DO NOTHING`,
        [q.householdId, accountId, day],
      );
      await q.query(
        `UPDATE daily_balances SET debits = debits + $4::numeric, credits = credits + $5::numeric
          WHERE household_id = $1 AND account_id = $2 AND day >= $3::date`,
        [q.householdId, accountId, day, debits.toDecimalString(), credits.toDecimalString()],
      );
      return true;
    },
    async accountIds(accountId) {
      const { rows } = await q.query<{ id: string }>(
        `SELECT id FROM accounts WHERE household_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid) ORDER BY id`,
        [q.householdId, accountId],
      );
      return rows.map((r) => r.id);
    },
    async rebuildBalance(accountId) {
      // A new version first: it waits for an update in progress, and an update that read the old version retries.
      await q.query(
        `INSERT INTO balance_versions (household_id, account_id, version) VALUES ($1, $2, 1)
         ON CONFLICT (household_id, account_id)
         DO UPDATE SET version = balance_versions.version + 1, changed_at = now()`,
        [q.householdId, accountId],
      );
      // After the version row (its lock is taken first, as by an update), so the two never wait on each other.
      await lockBalanceCreation(q, accountId);
      return rebuildDays(q, accountId);
    },
    async integrity(): Promise<IntegrityFindings> {
      const { rows } = await q.query<{
        unbalanced_entry: number;
        empty_entry: number;
        reversal_mismatch: number;
        balance_cache: number;
      }>(INTEGRITY, [q.householdId]);
      const r = rows[0]!;
      return {
        "unbalanced-entry": r.unbalanced_entry,
        "empty-entry": r.empty_entry,
        "reversal-mismatch": r.reversal_mismatch,
        "balance-cache": r.balance_cache,
      };
    },
  };
}

export function databaseLedgerStore(db: ModuleDatabase): LedgerStore {
  return { inHousehold: (householdId, work) => db.inHousehold(householdId, (q) => work(tx(q))) };
}

/**
 * The claims of discrepancy periods (migrations/0002_integrity_alerts.sql), bound to no space. Append-only: every
 * change is the next row; the latest row is the state. Two writers of the same next row: the primary key lets one in.
 */
export function databaseIntegrityAlertStore(db: ModuleDatabase): IntegrityAlertStore {
  /** Appends the next state unless the latest one already is `period`; true when this call appended it. */
  const advance = (period: string | null, at: number, when: (latest: string | null) => boolean) =>
    db.transaction(async (q) => {
      const { rows } = await q.query<{ seq: number; period: string | null }>(
        `SELECT seq, period FROM integrity_alerts ORDER BY seq DESC LIMIT 1`,
      );
      const latest = rows[0];
      if (!when(latest?.period ?? null)) return false;
      const inserted = await q.query(
        `INSERT INTO integrity_alerts (seq, period, recorded_at) VALUES ($1, $2, $3)
         ON CONFLICT (seq) DO NOTHING RETURNING seq`,
        [(latest?.seq ?? 0) + 1, period, new Date(at)],
      );
      return inserted.rows.length === 1;
    });
  return {
    // Changed findings end the previous period: any other latest state lets the claim in.
    claim: (period, at) => advance(period, at, (latest) => latest !== period),
    async release(period, at) {
      await advance(null, at, (latest) => latest === period);
    },
    async endPeriod(at) {
      await advance(null, at, (latest) => latest !== null);
    },
  };
}
