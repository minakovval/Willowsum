// Application layer of liabilities: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export {
  registerLiability,
  type LiabilitiesTx,
  type Liability,
  type LiabilityAudit,
  type RegisterResult,
} from "./liabilities.ts";
