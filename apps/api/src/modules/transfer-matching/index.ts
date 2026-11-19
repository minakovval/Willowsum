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
