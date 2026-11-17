// Domain layer of merchants: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export { mergeIssue, type Merchant, type MergeIssue } from "./merchant.ts";
export {
  MERCHANT_NAME_MAX,
  merchantInitials,
  merchantKey,
  merchantName,
  normalizeDescription,
  type NormalizedMerchant,
} from "./normalize.ts";
export {
  groupReviewQueue,
  NO_MERCHANT_GROUP,
  suggestGroupCategory,
  type GroupSuggestion,
  type QueueSlice,
  type ReviewGroup,
} from "./review-groups.ts";
