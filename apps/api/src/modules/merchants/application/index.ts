// Application layer of merchants: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export { applyHandOff, auditKey, handOffKey, type MerchantAudit, type MerchantHandOff } from "./hand-off.ts";
export {
  listMerchants,
  mergeMerchants,
  merchantOfTransaction,
  renameMerchant,
  shownMerchants,
  unmergeMerchant,
  type ChangeResult,
  type ListedMerchant,
  type MerchantsTx,
  type TransactionMerchant,
  type TransactionTextsPort,
} from "./merchants.ts";
