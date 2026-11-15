// Domain layer of categorization: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export {
  CATEGORY_SOURCES,
  UNCATEGORIZED,
  categoryAllowed,
  pickCategory,
  proposalApplies,
  rankOf,
  refusal,
  type CategorizableFacts,
  type CategorizableIssue,
  type CategoryFacts,
  type CategorySource,
  type TransactionCategory,
} from "./transaction-category.ts";
