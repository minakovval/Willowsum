import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import type { ImportCounts, ImportWriteTx } from "../../application/index.ts";
import { importCandidates } from "./import-candidates.ts";
import { transactionsTx } from "./store.ts";

/**
 * How long an apply waits for the import lock of an account another apply holds (application/imported.ts step 1): a
 * batch of 50 files of 20 000 rows takes a while; a waiter past this gives up (55P03, 500: try again), nothing written.
 */
export const IMPORT_LOCK_WAIT = "60s";

/** The write of an import batch in one transactions transaction (application/imported.ts). */
export function importWriteTx(q: HouseholdQueryRunner): ImportWriteTx {
  const tx = transactionsTx(q);
  return {
    async lockImport(householdId, accountIds) {
      const { rows } = await q.query<{ before: string }>(`SELECT current_setting('lock_timeout') AS before`);
      await q.query(`SELECT set_config('lock_timeout', $1, true)`, [IMPORT_LOCK_WAIT]);
      for (const id of accountIds)
        await q.query(
          `SELECT pg_advisory_xact_lock(hashtextextended('transactions.import:' || $1 || ':' || $2, 0))`,
          [householdId, id],
        );
      await q.query(`SELECT set_config('lock_timeout', $1, true)`, [rows[0]!.before]);
    },
    async written(householdId, batchId) {
      const { rows } = await q.query<{ counts: ImportCounts }>(
        `SELECT counts FROM import_writes WHERE household_id = $1 AND import_batch_id = $2`,
        [householdId, batchId],
      );
      return rows[0]?.counts ?? null;
    },
    lockAccounts: (householdId, accountIds) => tx.lockAccounts(householdId, accountIds),
    async insertImported(householdId, t) {
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO transactions (household_id, id, account_id, subaccount_id, amount, currency, occurred_on,
                                   counterparty, description, status, source, version, review, import_batch_id,
                                   import_file_id, import_row, bank_description, balance_after)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (household_id, import_batch_id, import_file_id, import_row) WHERE import_file_id IS NOT NULL
         DO NOTHING RETURNING id`,
        [
          householdId,
          t.id,
          t.accountId,
          t.subaccountId,
          t.amount.toDecimalString(),
          t.amount.currency,
          t.date,
          t.counterparty,
          t.description,
          t.status,
          t.source,
          t.version,
          t.review,
          t.importBatchId,
          t.importFileId,
          t.importRow,
          t.bankDescription,
          t.balanceAfter?.toDecimalString() ?? null,
        ],
      );
      return rows[0] ? tx.find(householdId, rows[0].id) : null;
    },
    async recordWrite(householdId, batchId, counts, actorId, at) {
      await q.query(
        `INSERT INTO import_writes (household_id, import_batch_id, counts, written_by, written_at)
         VALUES ($1, $2, $3::jsonb, $4, $5)`,
        [householdId, batchId, JSON.stringify(counts), actorId, at],
      );
    },
    enqueueHandOff: (householdId, handOff) => tx.enqueueHandOff(householdId, handOff),
    publishCreated: (householdId, id) => tx.publishCreated(householdId, id),
    candidates: { page: (householdId, query) => importCandidates(q, householdId, query) },
  };
}
