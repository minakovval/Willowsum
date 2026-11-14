// Application layer of ledger: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export {
  assertDate,
  assertMoment,
  BALANCE_ATTEMPTS,
  balanceAt,
  correct,
  dailyIntegrityCheck,
  INTEGRITY_CHECKS,
  liveEntries,
  openAccount,
  post,
  rebuildBalances,
  reverse,
} from "./journal.ts";
export { alertIntegrityFindings, integrityAlertMessage, integrityPeriodKey } from "./integrity-alert.ts";
export type {
  IntegrityAlert,
  IntegrityAlertDeps,
  IntegrityAlertEvent,
  IntegrityAlertStore,
  IntegrityAlertSummary,
} from "./integrity-alert.ts";
export type {
  Entry,
  EntrySource,
  IntegrityCheck,
  IntegrityFindings,
  JournalDeps,
  LedgerAccount,
  LedgerStore,
  LedgerTx,
  NewEntry,
  PostInput,
  StoredPosting,
} from "./journal.ts";
