import type { StoredApplication } from "./applications.ts";
import { BatchNotFoundError, BatchStateErrorFor, type Batch } from "./batches.ts";
import type { ApplyBatchesTx } from "./apply.ts";

/**
 * The wizard's step «Результат» (IMP-08@PoC FR 11, FR 12, AC7; plan row 138, the server part). Read only, any number of
 * times (the step is reopened by its address, FR 1): the stored result of the batch's apply — the counts of created,
 * replaced and skipped rows — and what is left to do after it, as the space is now: the card payments the apply
 * recorded as transfers, the proposals of transfers with a side of this batch (confirmed on the tab «Пари», FR 12) and
 * the batch's transactions without a category (the queue «До розбору»). Each count comes from the module that owns it,
 * through its public interface: transactions (the batch's transactions), categorization (which have a category),
 * transfer-matching (the proposals). Nothing of a row — no text, no amount — is in it.
 */

/** The batch's transactions read per page when the ones without a category are counted. */
export const RESULT_PAGE = 1_000;

export interface ResultPorts {
  /** Module transactions' `ImportBatchTransactions.page`, for the caller's space. */
  readonly transactions: (query: {
    readonly batchId: string;
    readonly limit: number;
    readonly after?: { readonly fileId: string; readonly row: number };
  }) => Promise<readonly { readonly transactionId: string; readonly fileId: string; readonly row: number }[]>;
  /** Module categorization's `TransactionCategories.categoriesOf`, for the caller's space: an absent id has none. */
  readonly categoriesOf: (ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  /** Module transfer-matching's `ImportBatchProposals.countFor`, for the caller's space. */
  readonly proposals: (batchId: string) => Promise<{ readonly count: number; readonly more: boolean }>;
}

export interface BatchFollowUp {
  /**
   * FR 11 «N платежів на картку записано як переказ» (IMP-03 FR 15): the card payments from an own account of the space
   * the apply recorded as a transfer at once. The apply does not record any yet (IMP-03 FR 15 is a later part): 0.
   */
  readonly cardPaymentTransfers: number;
  /** FR 11, AC7 «N пар переказів», «Пари · N»: the proposals with a side of this batch; `more` — the read was capped. */
  readonly transferProposals: { readonly count: number; readonly more: boolean };
  /** FR 11, AC7 «N без категорії»: the batch's shown transactions, not split and no side of a transfer, without one. */
  readonly uncategorized: number;
}

export interface BatchResult {
  readonly batch: Batch;
  readonly application: StoredApplication;
}

/**
 * The batch and its finished apply. Another space's batch (or none) — `BatchNotFoundError`; a batch with no finished
 * apply (never applied, or «in progress») — `BatchStateErrorFor`.
 */
export async function batchResult(
  tx: Pick<ApplyBatchesTx, "findBatch" | "application">,
  batchId: string,
): Promise<BatchResult> {
  const batch = await tx.findBatch(batchId);
  if (!batch) throw new BatchNotFoundError();
  const application = await tx.application(batchId);
  if (!application || application.inProgress) throw new BatchStateErrorFor(batch.state);
  return { batch, application };
}

/** What is left to do after the apply, read from the modules that own it (bounded: pages of `RESULT_PAGE`). */
export async function followUpOf(ports: ResultPorts, batchId: string): Promise<BatchFollowUp> {
  let uncategorized = 0;
  let after: { fileId: string; row: number } | undefined;
  for (;;) {
    const page = await ports.transactions({ batchId, limit: RESULT_PAGE, ...(after ? { after } : {}) });
    if (page.length === 0) break;
    const categories = await ports.categoriesOf(page.map((t) => t.transactionId));
    uncategorized += page.filter((t) => !categories.has(t.transactionId)).length;
    if (page.length < RESULT_PAGE) break;
    const last = page.at(-1)!;
    after = { fileId: last.fileId, row: last.row };
  }
  const transferProposals = await ports.proposals(batchId);
  return { cardPaymentTransfers: 0, transferProposals, uncategorized };
}
