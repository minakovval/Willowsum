// Domain layer of feature-flags: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export {
  FLAG_KEYS,
  FLAG_KINDS,
  FLAGS,
  FULL_ROLLOUT_MAX_DAYS,
  flagDefinition,
  isFlagKey,
} from "./catalogue.ts";
export type { FlagDefinition, FlagKey, FlagKind } from "./catalogue.ts";
export { BUCKETS, bucketOf, isOnFor, OFF, ROLLOUT_STAGES, rollout } from "./rollout.ts";
export type { Rollout, RolloutStage } from "./rollout.ts";
export { flagReviewProblems, MAX_REQUIRES_DEPTH, overdueFullRollouts, utcDay } from "./review.ts";
