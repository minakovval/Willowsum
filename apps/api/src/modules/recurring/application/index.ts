// Application layer of recurring: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export {
  HISTORY_DAYS,
  HISTORY_MAX,
  listProposals,
  type HistoryCharge,
  type Proposal,
  type ProposalDeps,
} from "./proposals.ts";
