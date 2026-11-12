import { Money } from "@willowsum/domain-kernel";
import type { HouseholdQueryRunner, ModuleDatabase } from "../../../../platform/db/module-db.ts";
import type {
  Entry,
  IntegrityAlertStore,
  IntegrityFindings,
  LedgerAccount,
  LedgerStore,
  LedgerTx,
} from "../../application/index.ts";
import { LedgerError, SERVICE_ACCOUNTS } from "../../domain/index.ts";

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
  per_account AS (SELECT entry_id, account_id, sum(signed) AS net FROM legs GROUP BY 1, 2)
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
      AS reversal_mismatch`;

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
    async integrity(): Promise<IntegrityFindings> {
      const { rows } = await q.query<{
        unbalanced_entry: number;
        empty_entry: number;
        reversal_mismatch: number;
      }>(INTEGRITY, [q.householdId]);
      const r = rows[0]!;
      return {
        "unbalanced-entry": r.unbalanced_entry,
        "empty-entry": r.empty_entry,
        "reversal-mismatch": r.reversal_mismatch,
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
