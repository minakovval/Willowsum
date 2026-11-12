// Domain layer of ledger: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export {
  ACCOUNT_TYPES,
  assertBalanced,
  LedgerError,
  MAX_POSTINGS,
  naturalBalance,
  refKey,
  SERVICE_ACCOUNTS,
  type AccountRef,
  type AccountType,
  type Posting,
  type ServiceAccount,
} from "./postings.ts";
export { EVENT_TYPES, postingsFor, RULES_VERSION, type LedgerEvent, type LedgerEventType } from "./rules.ts";
