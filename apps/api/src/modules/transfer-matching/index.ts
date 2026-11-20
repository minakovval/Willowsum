// Public interface of the transfer-matching module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";
import { listProposals, type ProposalDeps } from "./application/index.ts";
import { transferMatchingRoutes } from "./adapters/index.ts";

export const transferMatchingModule = defineModule({
  name: "transfer-matching",
  publishes: [],
  consumes: [],
  routes: transferMatchingRoutes,
});

export { createTransferMatchingServices, type TransferMatchingServices } from "./adapters/index.ts";
export { CROSS_CURRENCY_MAX_SHARE, FEE_MAX_SHARE, MATCH_WINDOW_DAYS } from "./domain/index.ts";

/**
 * BUD-08@PoC FR 8 (wave 2 row 37): the transactions that are a side of a proposed transfer not yet confirmed — «Пари · N»
 * as `GET /v1/transfer-proposals` finds it — for module cashflow («Перекази без пари»). Read only; nothing is stored.
 */
export interface TransferProposalSides {
  pendingSides(householdId: string): Promise<ReadonlySet<string>>;
}

/** `deps` as for `createTransferMatchingServices`: the transactions module's candidate pairs and fx-rates' rates. */
export function createTransferProposalSides(deps: ProposalDeps): TransferProposalSides {
  return {
    async pendingSides(householdId) {
      const { proposals } = await listProposals(deps, householdId);
      return new Set(proposals.flatMap((p) => [p.outflow.transactionId, p.inflow.transactionId]));
    },
  };
}

/**
 * IMP-08@PoC FR 11, AC7 (the step «Результат»): how many of the proposals «Пари · N» (the same read as
 * `GET /v1/transfer-proposals`, as the space's transactions are now) have a side written by one import batch, for module
 * import-sessions; `more` — the read looked at its `CANDIDATES_MAX` pairs, so there may be more. Read only.
 */
export interface ImportBatchProposals {
  countFor(householdId: string, batchId: string): Promise<{ readonly count: number; readonly more: boolean }>;
}

/** `deps` as for `createTransferMatchingServices`. */
export function createImportBatchProposals(deps: ProposalDeps): ImportBatchProposals {
  return {
    async countFor(householdId, batchId) {
      const { proposals, more } = await listProposals(deps, householdId);
      const count = proposals.filter(
        (p) => p.outflow.importBatchId === batchId || p.inflow.importBatchId === batchId,
      ).length;
      return { count, more };
    },
  };
}
