// Application layer of categorization: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export { applyHandOff, auditKey, handOffKey, type CategoryAudit, type CategoryHandOff } from "./hand-off.ts";
export {
  applyMerge,
  categoriesInUse,
  categoryOf,
  checkChange,
  setCategory,
  writeCategory,
  type CategorizationTx,
  type CategoryFactsPort,
  type SetDeps,
  type SetResult,
  type StoredTransactionCategory,
  type TransactionFactsPort,
  type WriteOutcome,
} from "./transaction-categories.ts";
