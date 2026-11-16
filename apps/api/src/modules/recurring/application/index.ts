// Application layer of recurring: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export {
  HISTORY_DAYS,
  HISTORY_MAX,
  listProposals,
  type Decisions,
  type HistoryCharge,
  type Proposal,
  type ProposalDeps,
} from "./proposals.ts";
export {
  applyCategoryMerge,
  applyHandOff,
  AUDIT_ENTITIES,
  checkReferences,
  confirmProposal,
  createPayment,
  GONE,
  HAND_OFF_ACTIONS,
  handOffKey,
  nextPaymentDate,
  rejectProposal,
  type Caller,
  type Handed,
  type PaymentDeps,
  type PaymentReferences,
  type RecurringAudit,
  type RecurringHandOff,
  type RecurringTx,
  type StoredPayment,
  type StoredRejection,
} from "./payments.ts";
