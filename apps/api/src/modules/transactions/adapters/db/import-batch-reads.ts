import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";

/**
 * The step «Результат» of the import wizard (IMP-08@PoC FR 11, AC7) for module import-sessions: the transactions an
 * applied batch wrote that a category is asked of — shown (not hidden, so not merged into another), not split (the
 * parts carry the categories) and no side of a transfer (its category is «Переказ»), as they are now. Module
 * categorization says which of them have a category. One page in the order of the batch's rows (file, row) after a
 * cursor, on the unique index `transactions_import_row` (household, batch, file, row). Read only; ids only.
 */
export interface ImportBatchTransaction {
  readonly transactionId: string;
  readonly fileId: string;
  readonly row: number;
}

export interface ImportBatchTransactionsQuery {
  readonly batchId: string;
  readonly limit: number;
  /** The last (file, row) of the previous page. */
  readonly after?: { readonly fileId: string; readonly row: number };
}

/** The statement of one page (exported for the test of its plan on the index). */
export const IMPORT_BATCH_TRANSACTIONS_SQL = `SELECT t.id, t.import_file_id, t.import_row
     FROM transactions t
    WHERE t.household_id = $1 AND t.import_batch_id = $2 AND t.import_file_id IS NOT NULL
      AND NOT t.hidden AND t.split_mode IS NULL AND t.transfer_id IS NULL
      AND ($3::uuid IS NULL OR (t.import_file_id, t.import_row) > ($3::uuid, $4::int))
    ORDER BY t.import_file_id, t.import_row
    LIMIT $5`;

export const importBatchTransactionsParams = (
  householdId: string,
  query: ImportBatchTransactionsQuery,
): unknown[] => [
  householdId,
  query.batchId,
  query.after?.fileId ?? null,
  query.after?.row ?? null,
  query.limit,
];

export async function importBatchTransactions(
  q: ModuleQueryRunner,
  householdId: string,
  query: ImportBatchTransactionsQuery,
): Promise<readonly ImportBatchTransaction[]> {
  const { rows } = await q.query<{ id: string; import_file_id: string; import_row: number }>(
    IMPORT_BATCH_TRANSACTIONS_SQL,
    importBatchTransactionsParams(householdId, query),
  );
  return rows.map((r) => ({ transactionId: r.id, fileId: r.import_file_id, row: r.import_row }));
}
