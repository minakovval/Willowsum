import {
  PlanTooLargeError,
  planBatch,
  planWindow,
  type IncomingRow,
  type KnownTransaction,
  type RowOutcome,
} from "../domain/index.ts";

/**
 * The plan of one file of an import batch (IMP-04@PoC FR 1–6; wave 2 row 43) for the apply step: reads the account's
 * transactions in the rows' window (dates ± 10 days) through the transactions module's public `ImportCandidates`, page
 * by page on its index, and runs the pure `planBatch`. Read only; nothing is written or marked. The apply step (the next
 * slice) calls it with the same file's earlier applied batch (import-sessions `sameFileApplied`, FR 3).
 */

/** One page of the account's transactions. */
export const PLAN_PAGE = 1_000;
/** The most transactions of the account one plan reads in its window; more — `PlanTooLargeError`, nothing planned. */
export const PLAN_EXISTING_MAX = 50_000;

export { PlanTooLargeError } from "../domain/index.ts";

export interface PlanDeps {
  /** The transactions module's public `ImportCandidates`. */
  readonly candidates: {
    page(
      householdId: string,
      query: {
        readonly accountId: string;
        readonly from: string;
        readonly to: string;
        readonly limit: number;
        readonly after?: { readonly date: string; readonly id: string };
      },
    ): Promise<readonly KnownTransaction[]>;
  };
}

export interface PlanRequest {
  readonly batchId: string;
  readonly accountId: string;
  readonly rows: readonly IncomingRow[];
  /** FR 3: the applied batch whose file has the same content (import-sessions `sameFileApplied`); null — none. */
  readonly sameFileAppliedIn: string | null;
  /** FR 4 (#655): the account is a credit card — a balance also matches by its size (`PlanInput.creditCard`). */
  readonly creditCard?: boolean;
}

export async function planImport(
  deps: PlanDeps,
  householdId: string,
  request: PlanRequest,
): Promise<readonly RowOutcome[]> {
  const window = planWindow(request.rows);
  const existing: KnownTransaction[] = [];
  if (window && request.sameFileAppliedIn === null)
    for (let after: { date: string; id: string } | undefined; ;) {
      const page = await deps.candidates.page(householdId, {
        accountId: request.accountId,
        ...window,
        limit: PLAN_PAGE,
        ...(after ? { after } : {}),
      });
      existing.push(...page);
      if (existing.length > PLAN_EXISTING_MAX) throw new PlanTooLargeError();
      const last = page[page.length - 1];
      if (page.length < PLAN_PAGE || !last) break;
      after = { date: last.date, id: last.transactionId };
    }
  return planBatch({ ...request, existing });
}
