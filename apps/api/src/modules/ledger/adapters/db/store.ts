import { Money } from "@willowsum/domain-kernel";
import type { HouseholdQueryRunner, ModuleDatabase } from "../../../../platform/db/module-db.ts";
import type { Entry, LedgerAccount, LedgerStore, LedgerTx } from "../../application/index.ts";
import { SERVICE_ACCOUNTS } from "../../domain/index.ts";

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
    async insertEntry(e) {
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
  };
}

export function databaseLedgerStore(db: ModuleDatabase): LedgerStore {
  return { inHousehold: (householdId, work) => db.inHousehold(householdId, (q) => work(tx(q))) };
}
