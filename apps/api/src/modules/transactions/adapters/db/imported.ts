import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import {
  IMPORT_WAITERS_MAX,
  ROLLBACK_KEPT_LISTED,
  type ImportCounts,
  type ImportRollbackCounts,
  type ImportRollbackTx,
  type ImportWriteTx,
  type RollbackRow,
} from "../../application/index.ts";
import { importCandidates } from "./import-candidates.ts";
import { publishEvent } from "../../../../platform/queue/index.ts";
import { transactionImportMerged } from "../../events.ts";
import { storedRow, STORED_COLUMNS, transactionsTx, type StoredRowShape } from "./store.ts";

/**
 * How long an apply waits for the import lock of an account another apply holds (application/imported.ts step 1): a
 * batch of 50 files of 20 000 rows takes a while; a waiter past this gives up (55P03, 500: try again), nothing written.
 */
export const IMPORT_LOCK_WAIT = "60s";

/** One waiter's place of the space (application/imported.ts step 0): tried without waiting, held to the end. */
const SLOT_LOCK = `SELECT pg_try_advisory_xact_lock(hashtextextended('transactions.import-slot:' || $1 || ':' || $2, 0)) AS ok`;

/** The write of an import batch in one transactions transaction (application/imported.ts). */
export function importWriteTx(q: HouseholdQueryRunner): ImportWriteTx {
  const tx = transactionsTx(q);
  return {
    async enterImport(householdId) {
      for (let slot = 0; slot < IMPORT_WAITERS_MAX; slot++) {
        const { rows } = await q.query<{ ok: boolean }>(SLOT_LOCK, [householdId, String(slot)]);
        if (rows[0]!.ok) return true;
      }
      return false;
    },
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
    async voided(householdId, batchId, attemptId) {
      const { rows } = await q.query(
        `SELECT 1 FROM import_voids WHERE household_id = $1 AND import_batch_id = $2 AND attempt_id = $3`,
        [householdId, batchId, attemptId],
      );
      return rows.length > 0;
    },
    async voidAttempt(householdId, batchId, attemptId, at) {
      await q.query(
        `INSERT INTO import_voids (household_id, import_batch_id, attempt_id, voided_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [householdId, batchId, attemptId, at],
      );
    },
    lockAccounts: (householdId, accountIds) => tx.lockAccounts(householdId, accountIds),
    lock: (householdId, id) => tx.lock(householdId, id),
    find: (householdId, id) => tx.find(householdId, id),
    async tryLock(householdId, id) {
      const { rows } = await q.query(
        `SELECT 1 FROM transactions WHERE household_id = $1 AND id = $2 FOR UPDATE SKIP LOCKED`,
        [householdId, id],
      );
      if (rows.length > 0) return tx.find(householdId, id);
      return (await tx.find(householdId, id)) === null ? null : "busy";
    },
    publishImportMerged: (householdId, merge) =>
      publishEvent({ ...q, householdId }, transactionImportMerged, merge).then(() => undefined),
    update: (householdId, row) => tx.update(householdId, row),
    duplicatesOf: (householdId, id) => tx.duplicatesOf(householdId, id),
    async insertImported(householdId, t) {
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO transactions (household_id, id, account_id, subaccount_id, amount, currency, occurred_on,
                                   counterparty, description, status, source, version, review, import_batch_id,
                                   import_file_id, import_row, bank_description, balance_after, note, tag_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::uuid[])
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
          t.note,
          [...t.tagIds],
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

/**
 * «Відкотити» a batch in one transactions transaction (application/rollback.ts): the waiter's place and the locks of the
 * apply's write, the batch's rows on the unique index of (batch, file, row), the rows merged into them on
 * `transactions_by_merged_into`, the record in `import_rollbacks`.
 */
export function importRollbackTx(q: HouseholdQueryRunner): ImportRollbackTx {
  const write = importWriteTx(q);
  const tx = transactionsTx(q);
  return {
    enterImport: write.enterImport,
    lockImport: write.lockImport,
    lockAccounts: write.lockAccounts,
    update: (householdId, row) => tx.update(householdId, row),
    enqueueHandOff: (householdId, handOff) => tx.enqueueHandOff(householdId, handOff),
    async rolledBackBatch(householdId, batchId) {
      const { rows } = await q.query<{ counts: ImportRollbackCounts; kept: string[] }>(
        `SELECT counts, kept::text[] AS kept FROM import_rollbacks WHERE household_id = $1 AND import_batch_id = $2`,
        [householdId, batchId],
      );
      return rows[0] ? { counts: rows[0].counts, kept: rows[0].kept } : null;
    },
    async batchRows(householdId, batchId) {
      const { rows } = await q.query<{ id: string; account_id: string }>(
        `SELECT id, account_id FROM transactions
          WHERE household_id = $1 AND import_batch_id = $2 AND import_file_id IS NOT NULL`,
        [householdId, batchId],
      );
      return rows.map((r) => ({ id: r.id, accountId: r.account_id }));
    },
    async mergedInto(householdId, ids) {
      if (ids.length === 0) return [];
      const { rows } = await q.query<{ id: string }>(
        `SELECT id FROM transactions WHERE household_id = $1 AND merged_into = ANY($2::uuid[]) ORDER BY id`,
        [householdId, [...ids]],
      );
      return rows.map((r) => r.id);
    },
    async lockRows(householdId, ids) {
      if (ids.length === 0) return [];
      const { rows } = await q.query<
        StoredRowShape & { import_batch_id: string | null; rolled_back: boolean }
      >(
        `SELECT ${STORED_COLUMNS}, import_batch_id, rolled_back_at IS NOT NULL AS rolled_back FROM transactions
          WHERE household_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
        [householdId, [...ids]],
      );
      const out: RollbackRow[] = [];
      for (const r of rows)
        out.push({
          ...(await storedRow(q, householdId, r)),
          importBatchId: r.import_batch_id,
          rolledBack: r.rolled_back,
        });
      return out;
    },
    async markRolledBack(householdId, id, at) {
      await q.query(`UPDATE transactions SET rolled_back_at = $3 WHERE household_id = $1 AND id = $2`, [
        householdId,
        id,
        at,
      ]);
    },
    async recordRollback(householdId, batchId, result, actorId, at) {
      await q.query(
        `INSERT INTO import_rollbacks (household_id, import_batch_id, counts, kept, rolled_back_by, rolled_back_at)
         VALUES ($1, $2, $3::jsonb, $4::uuid[], $5, $6)`,
        [
          householdId,
          batchId,
          JSON.stringify(result.counts),
          result.kept.slice(0, ROLLBACK_KEPT_LISTED),
          actorId,
          at,
        ],
      );
    },
  };
}
