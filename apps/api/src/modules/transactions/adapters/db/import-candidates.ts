import { Money } from "@willowsum/domain-kernel";
import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";

/**
 * What module duplicate-matching reads to plan an import batch (IMP-04@PoC FR 1–6; wave 2 row 43): the transactions of
 * one account dated in [from, to], hidden ones too (a hidden imported one is still in the balance), never a merged
 * manual duplicate (it is the same operation as the one it is merged into — a manual one merged into the bank's row on
 * apply, IMP-04 FR 5, too); a merged imported one is read (`merged`): a replaced pending one (IMP-04 FR 6) is still the
 * key match of the same row in a later statement. A transaction rolled back with its batch (IMP-16 FR 2) is never read. One page in the order of (date, id) after a cursor,
 * on the index `transactions_by_account`. Read only; the rule of duplicate-matching decides.
 */
export interface ImportCandidate {
  readonly transactionId: string;
  readonly accountId: string;
  /** Signed, in the transaction's currency. */
  readonly amount: Money;
  readonly date: string;
  /** The bank's text of an imported one (kept apart from the user's edits, #637), else the description. */
  readonly description: string | null;
  /** The balance after the operation as the statement printed it; null — none (a manual one). */
  readonly balanceAfter: Money | null;
  readonly status: "posted" | "pending";
  readonly source: "manual" | "imported";
  /** The import batch that created it; null — a manual one. */
  readonly importBatchId: string | null;
  readonly hidden: boolean;
  /** A side of a transfer between own accounts. */
  readonly transfer: boolean;
  /** Another transaction is merged into it («ще ні з чим не зіставлена» is false). */
  readonly matched: boolean;
  /** Merged into another transaction (an imported one: a replaced pending one). */
  readonly merged: boolean;
}

export interface ImportCandidatesQuery {
  readonly accountId: string;
  readonly from: string;
  readonly to: string;
  readonly limit: number;
  /** The last (date, id) of the previous page. */
  readonly after?: { readonly date: string; readonly id: string };
}

interface Row {
  id: string;
  account_id: string;
  amount: string;
  currency: string;
  occurred_on: string;
  description: string | null;
  balance_after: string | null;
  status: "posted" | "pending";
  source: "manual" | "imported";
  import_batch_id: string | null;
  hidden: boolean;
  transfer: boolean;
  matched: boolean;
  merged: boolean;
}

/** The statement of one page (exported for the test of its plan on the index). */
export const IMPORT_CANDIDATES_SQL = `SELECT t.id, t.account_id, t.amount::text AS amount, t.currency, t.occurred_on::text AS occurred_on,
          COALESCE(t.bank_description, t.description) AS description, t.balance_after::text AS balance_after,
          t.status, t.source, t.import_batch_id, t.hidden,
          t.transfer_id IS NOT NULL AS transfer, t.merged_into IS NOT NULL AS merged,
          EXISTS (SELECT 1 FROM transactions m
                   WHERE m.household_id = t.household_id AND m.merged_into = t.id) AS matched
     FROM transactions t
    WHERE t.household_id = $1 AND t.account_id = $2 AND t.occurred_on BETWEEN $3::date AND $4::date
      AND (t.merged_into IS NULL OR t.source = 'imported') AND t.rolled_back_at IS NULL
      AND ($5::date IS NULL OR (t.occurred_on, t.id) > ($5::date, $6::uuid))
    ORDER BY t.occurred_on, t.id
    LIMIT $7`;

export const importCandidatesParams = (householdId: string, query: ImportCandidatesQuery): unknown[] => [
  householdId,
  query.accountId,
  query.from,
  query.to,
  query.after?.date ?? null,
  query.after?.id ?? null,
  query.limit,
];

export async function importCandidates(
  q: ModuleQueryRunner,
  householdId: string,
  query: ImportCandidatesQuery,
): Promise<readonly ImportCandidate[]> {
  const { rows } = await q.query<Row>(IMPORT_CANDIDATES_SQL, importCandidatesParams(householdId, query));
  return rows.map((r) => ({
    transactionId: r.id,
    accountId: r.account_id,
    amount: Money.of(r.amount, r.currency),
    date: r.occurred_on,
    description: r.description,
    balanceAfter: r.balance_after === null ? null : Money.of(r.balance_after, r.currency),
    status: r.status,
    source: r.source,
    importBatchId: r.import_batch_id,
    hidden: r.hidden,
    transfer: r.transfer,
    matched: r.matched,
    merged: r.merged,
  }));
}
