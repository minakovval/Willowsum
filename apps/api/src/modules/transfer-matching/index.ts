// Public interface of the transfer-matching module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";
import { logEvent } from "../../platform/telemetry/signals.ts";
import {
  flagOneSidedTransfers,
  listProposals,
  markCardPayments,
  type CardPaymentDeps,
  type FreshSides,
  type ProposalDeps,
} from "./application/index.ts";
import { transferMatchingRoutes } from "./adapters/index.ts";

export const transferMatchingModule = defineModule({
  name: "transfer-matching",
  publishes: [],
  consumes: [],
  routes: transferMatchingRoutes,
});

export { createTransferMatchingServices, type TransferMatchingServices } from "./adapters/index.ts";
export { CROSS_CURRENCY_MAX_SHARE, FEE_MAX_SHARE, MATCH_WINDOW_DAYS } from "./domain/index.ts";
export { ONE_SIDED_AFTER_DAYS } from "./domain/index.ts";
export type { OneSidedDeps } from "./application/index.ts";

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

/**
 * BUD-01@PoC FR 7, AC4 (#722 D): the exception to «лише пропозиція» — right after new transactions arrive, each
 * unambiguous pair «списання з власного рахунку простору — зарахування на кредитну картку простору» with a new side
 * becomes a transfer at once through the transactions module's mark (journal, audit). `fresh` names the new sides: the
 * ids of transactions entered by hand, or an import batch (its written rows). How many pairs were marked. Idempotent:
 * a marked pair is no proposal any more, and a repeated import writes no new side.
 */
export interface CardPaymentTransfers {
  markFor(householdId: string, actorAccountId: string, fresh: FreshSides): Promise<number>;
}
export type { CardPaymentDeps, FreshSides };

/** `deps`: as for `createTransferMatchingServices`, plus the space's credit cards, the transfers flag and the mark. */
export function createCardPaymentTransfers(deps: CardPaymentDeps): CardPaymentTransfers {
  return {
    async markFor(householdId, actorAccountId, fresh) {
      const marked = await markCardPayments(deps, householdId, actorAccountId, fresh);
      // IMP-03@PoC FR 1, FR 14, FR 15 (row 242): then the one-sided transfers among the free transactions. A failure
      // never undoes the marks; «Шукати пари знову» flags them later (FR 16). Class only, never a value.
      if (deps.oneSided && (await deps.enabled(householdId)))
        try {
          await flagOneSidedTransfers(deps, deps.oneSided, householdId, actorAccountId);
        } catch (error) {
          logEvent("transfer_matching.one_sided_deferred", "warn", {
            "ws.module": "transfer-matching",
            "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
          });
        }
      return marked;
    },
  };
}
