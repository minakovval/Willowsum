// Domain layer of liabilities: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export {
  availableCredit,
  checkTerms,
  GRACE_PERIOD_MAX_DAYS,
  LIABILITY_KINDS,
  parseAnnualRate,
  parseTypedAmount,
  type LiabilityKind,
  type LiabilityTerms,
  type LiabilityTermsInput,
  type TermsIssue,
} from "./liabilities.ts";
