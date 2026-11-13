// Public interface of the ledger module (ARC-01 FR 2). Other modules import only this file.
import { randomUUID } from "node:crypto";
import type { Money } from "@willowsum/domain-kernel";
import { systemClock } from "../../platform/adapters/index.ts";
import type { MailSender } from "../../platform/adapters/mail/index.ts";
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import {
  databaseIntegrityAlertStore,
  databaseLedgerStore,
  eraseHouseholdJournal,
  integrityAlertMail,
  logIntegrityAlertEvent,
  logIntegrityCheckFailed,
  logIntegrityViolation,
} from "./adapters/index.ts";
import {
  alertIntegrityFindings,
  balanceAt,
  correct,
  dailyIntegrityCheck,
  openAccount,
  post,
  reverse,
  type Entry,
  type EntrySource,
  type IntegrityAlertEvent,
  type IntegrityCheck,
  type IntegrityFindings,
  type LedgerAccount,
  type PostInput,
} from "./application/index.ts";
import type { AccountType } from "./domain/index.ts";

export const ledgerModule = defineModule({
  name: "ledger",
  publishes: [],
  consumes: [],
});

export { ACCOUNT_TYPES, EVENT_TYPES, LedgerError, RULES_VERSION, SERVICE_ACCOUNTS } from "./domain/index.ts";
export type { AccountType, LedgerEvent, LedgerEventType, ServiceAccount } from "./domain/index.ts";
export { INTEGRITY_CHECKS } from "./application/index.ts";
export type {
  Entry,
  EntrySource,
  IntegrityAlertEvent,
  IntegrityCheck,
  IntegrityFindings,
  LedgerAccount,
  PostInput,
  StoredPosting,
} from "./application/index.ts";

/** The double-entry journal of the spaces (FIN-04@PoC, ARC-11; ADR-0011). Every call is bound to one space. */
export interface Ledger {
  /** The ledger account of an owner module's record (a cash account, an asset, a liability). Idempotent. */
  openAccount(
    householdId: string,
    owner: EntrySource,
    account: { readonly type: AccountType; readonly currency: string },
  ): Promise<LedgerAccount>;
  /** Posts an event as one balanced posting set, atomically; a repeated idempotency key returns the entry made. */
  post(householdId: string, input: PostInput): Promise<Entry>;
  /** Offsets an entry with a reversal (deleting its event). */
  reverse(householdId: string, entryId: string, idempotencyKey: string): Promise<Entry>;
  /** Reversal of the entry and the replacement entry, in one transaction (changing its event). */
  correct(
    householdId: string,
    entryId: string,
    replacement: PostInput,
  ): Promise<{ readonly reversal: Entry; readonly entry: Entry }>;
  /** The balance of an account on a date (inclusive); `asKnownAt` limits it to entries recorded by then. */
  balanceAt(
    householdId: string,
    accountId: string,
    date: string,
    options?: { readonly asKnownAt?: string },
  ): Promise<Money>;
}

/** `db` is the ledger module's own database (`ModuleDatabases.for("ledger")`). */
export function createLedger(db: ModuleDatabase): Ledger {
  const deps = { store: databaseLedgerStore(db), newId: randomUUID };
  return {
    openAccount: (householdId, owner, account) => openAccount(deps, householdId, owner, account),
    post: (householdId, input) => post(deps, householdId, input),
    reverse: (householdId, entryId, key) => reverse(deps, householdId, entryId, key),
    correct: (householdId, entryId, replacement) => correct(deps, householdId, entryId, replacement),
    balanceAt: (householdId, accountId, date, options) =>
      balanceAt(deps, householdId, accountId, date, options),
  };
}

/** The alert letter of the daily integrity check (owner decision 2026-11-12: PoC alerts are letters from the app). */
export interface LedgerIntegrityAlerts {
  /**
   * The app's mail adapter and the product owner's address (`WS_ALERT_EMAIL`). Without it a discrepancy is only
   * logged, with an «error» event that no letter could go out.
   */
  readonly alertMail?: { readonly mail: MailSender; readonly to: string };
  /** The time of a claim; the system clock unless a test passes its own. */
  readonly clock?: { now(): number };
  readonly report?: (event: IntegrityAlertEvent) => void;
}

/**
 * The scheduler's daily integrity check (FIN-04 FR 9, FR 10, AC7). `spaces` lists every space (the household
 * module); a failed check goes to the server log as an «error» event without amounts or account names. With
 * `alerts`, a discrepancy also sends the one letter of its period to the product owner (kinds and counts only).
 */
export function createLedgerIntegrityCheck(
  db: ModuleDatabase,
  spaces: () => Promise<readonly string[]>,
  report: (check: IntegrityCheck, entries: number) => void = logIntegrityViolation,
  failed: (spaces: number) => void = logIntegrityCheckFailed,
  alerts?: LedgerIntegrityAlerts,
): { run(): Promise<IntegrityFindings> } {
  const store = databaseLedgerStore(db);
  const alertDeps = alerts && {
    store: databaseIntegrityAlertStore(db),
    clock: alerts.clock ?? systemClock,
    report: alerts.report ?? logIntegrityAlertEvent,
    ...(alerts.alertMail ? { alert: integrityAlertMail(alerts.alertMail) } : {}),
  };
  return {
    async run() {
      let failedSpaces = 0;
      const findings = await dailyIntegrityCheck({
        store,
        spaces,
        report,
        failed: (n) => {
          failedSpaces = n;
          failed(n);
        },
      });
      if (alertDeps) await alertIntegrityFindings(alertDeps, findings, failedSpaces);
      return findings;
    },
  };
}

/** Erasure of a space's journal (NFR-12@PoC FR 3, ARC-11 «Видалення даних»; ADR-0013): the owner's erasure script only. */
export interface LedgerErasure {
  /** Deletes the space's postings, entries and accounts in one transaction. Repeating it deletes nothing. */
  eraseHousehold(
    householdId: string,
  ): Promise<{ readonly postings: number; readonly entries: number; readonly accounts: number }>;
}

/** `db` is ledger's erasure database (`withErasureDatabases(…).for("ledger")`, role `ws_era_ledger`). */
export function createLedgerErasure(db: ModuleDatabase): LedgerErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdJournal(db, householdId) };
}
