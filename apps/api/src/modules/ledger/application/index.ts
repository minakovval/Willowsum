// Application layer of ledger: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export { assertDate, assertMoment, balanceAt, openAccount, post } from "./journal.ts";
export type {
  Entry,
  EntrySource,
  JournalDeps,
  LedgerAccount,
  LedgerStore,
  LedgerTx,
  NewEntry,
  PostInput,
  StoredPosting,
} from "./journal.ts";
