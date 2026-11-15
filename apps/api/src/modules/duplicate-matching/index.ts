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
  decideIncoming,
  isPossibleDuplicate,
  MATCH_WINDOW_DAYS,
  type DuplicateSide,
  type ExistingTransaction,
  type IncomingDecision,
} from "./domain/index.ts";
