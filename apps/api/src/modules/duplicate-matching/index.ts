// Public interface of the duplicate-matching module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";
import { duplicateMatchingRoutes } from "./adapters/index.ts";

export const duplicateMatchingModule = defineModule({
  name: "duplicate-matching",
  publishes: [],
  consumes: [],
  routes: duplicateMatchingRoutes,
});

export {
  createDuplicateCheck,
  createDuplicateMatchingServices,
  type DuplicateMatchingServices,
} from "./adapters/index.ts";
export {
  planImport,
  PLAN_EXISTING_MAX,
  PLAN_PAGE,
  PlanTooLargeError,
  type PlanDeps,
  type PlanRequest,
} from "./application/index.ts";
export {
  duplicateKey,
  normalizeDescription,
  outcomeCounts,
  planBatch,
  planWindow,
  REPLACE_TOLERANCE,
  REPLACE_WINDOW_DAYS,
  ROW_OUTCOMES,
  type IncomingRow,
  type KnownTransaction,
  type PlanInput,
  type RowOutcome,
  type RowOutcomeKind,
  decideIncoming,
  isPossibleDuplicate,
  MATCH_WINDOW_DAYS,
  type DuplicateSide,
  type ExistingTransaction,
  type IncomingDecision,
} from "./domain/index.ts";
