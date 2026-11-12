// Public interface of the ledger module (ARC-01 FR 2). Other modules import only this file.
import { randomUUID } from "node:crypto";
import type { Money } from "@willowsum/domain-kernel";
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import { databaseLedgerStore } from "./adapters/index.ts";
import {
  balanceAt,
  openAccount,
  post,
  type Entry,
  type EntrySource,
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
export type { Entry, EntrySource, LedgerAccount, PostInput, StoredPosting } from "./application/index.ts";

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
    balanceAt: (householdId, accountId, date, options) =>
      balanceAt(deps, householdId, accountId, date, options),
  };
}
