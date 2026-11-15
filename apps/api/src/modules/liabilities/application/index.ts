// Application layer of liabilities: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export {
  changeLiabilityKind,
  changeLiabilityTerms,
  liabilityTermsHistory,
  registerLiability,
  type ChangeKindResult,
  type ChangeTermsResult,
  type Handed,
  type LiabilitiesTx,
  type Liability,
  type RegisterResult,
} from "./liabilities.ts";
export {
  applyHandOff,
  auditKey,
  handOffKey,
  LIABILITY_HAND_OFF_ACTIONS,
  type LiabilityAudit,
  type LiabilityAuditChange,
  type LiabilityHandOff,
} from "./hand-off.ts";
