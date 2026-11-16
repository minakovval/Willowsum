// Public interface of the transactions module (ARC-01 FR 2). Other modules import only this file.
import type { Money } from "@willowsum/domain-kernel";
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import type { WalletUsage } from "../accounts/index.ts";
import type { CategoryUsage } from "../categories/index.ts";
import { ApiProblem } from "../../platform/http/problem.ts";
import {
  budgetRows,
  categoriesInParts,
  categorizableFacts,
  counterpartiesOf,
  counterpartyCounts,
  recurringHistory,
  recurringMatching,
  subaccountsInUse,
  eraseHouseholdTransactions,
  HAND_OFF_JOB,
  requeueDeadHandOffs,
  transactionAudit,
  transactionsList,
  transactionsRoutes,
  transactionsWorkerQueue,
  transferCandidates,
  duplicateCandidates,
  type CandidateSide,
  type DuplicateSide,
} from "./adapters/index.ts";
import type { HandOffDeps } from "./application/index.ts";

export const transactionsModule = defineModule({
  name: "transactions",
  publishes: [],
  consumes: [],
  routes: transactionsRoutes,
});

export { createTransactionsServices, type TransactionsServices } from "./adapters/index.ts";
export { TRANSACTION_TYPES, typeOf } from "./domain/index.ts";

/** The transactions queue's job (ARC-04): the hand-off of a create, an edit or a delete to the journal and audit. */
export { HAND_OFF_JOB };

/**
 * The worker's transactions queue (ARC-04 FR 2, FR 3; src/wiring.ts): the hand-off jobs in the transactions schema,
 * run with the same ports as the routes' — `db` the transactions database, the accounts directory, the journal and
 * the audit log.
 */
export function createTransactionsWorkerQueue(
  db: ModuleDatabase,
  ports: {
    readonly accounts: HandOffDeps["accounts"];
    readonly ledger: HandOffDeps["ledger"];
    readonly audit: Pick<AuditLog, "record">;
  },
): WorkerQueue {
  return transactionsWorkerQueue(db, {
    accounts: ports.accounts,
    ledger: ports.ledger,
    audit: transactionAudit(ports.audit),
  });
}

/**
 * The scheduler's daily recovery of the hand-off (ARC-04 FR 2–4; src/wiring.ts): puts the hand-off jobs the worker gave
 * up on back in the transactions queue, so no transaction stays without its journal event and audit entry for good.
 * Returns how many jobs went back. Idempotent.
 */
export function createTransactionsHandOffRecovery(
  db: ModuleDatabase,
  households: () => Promise<readonly string[]>,
): { run(): Promise<number> } {
  return {
    async run() {
      let requeued = 0;
      for (const householdId of await households()) requeued += await requeueDeadHandOffs(db, householdId);
      return requeued;
    },
  };
}
export type { TransactionType } from "./domain/index.ts";

/** Erasure of a space's transactions (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface TransactionsErasure {
  /** Deletes every transaction of the space, the stored create responses and the queue rows (ARC-04). Idempotent. */
  eraseHousehold(
    householdId: string,
  ): Promise<{ readonly transactions: number; readonly idempotencyKeys: number; readonly jobs: number }>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createTransactionsErasure(db: ModuleDatabase): TransactionsErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdTransactions(db, householdId) };
}

/**
 * The candidate pairs of transfers between own accounts (FIN-03@PoC FR 5) for module transfer-matching, which decides
 * by its rule which are proposals: a debit and a credit on two accounts of the space within `windowDays`, both posted,
 * shown, not split and in no transfer; in one currency the credit at most the debit and at least `sameCurrencyMinShare`
 * of it. Newest first, at most `limit`. Read only.
 */
export interface TransferCandidates {
  candidatePairs(
    householdId: string,
    query: { readonly windowDays: number; readonly sameCurrencyMinShare: string; readonly limit: number },
  ): Promise<{ readonly outflow: CandidateSide; readonly inflow: CandidateSide }[]>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createTransferCandidates(db: ModuleDatabase): TransferCandidates {
  return {
    candidatePairs: (householdId, query) =>
      db.inHousehold(householdId, (q) => transferCandidates(q, householdId, query)),
  };
}
export type { CandidateSide };

/**
 * The possible duplicates (FIN-03@PoC FR 12) for module duplicate-matching, which decides by its rule: two shown
 * transactions on one account with the same amount and currency within `windowDays`, neither a side of a transfer nor
 * merged, the pair not «Не дубль». `first` is the earlier. Newest first, at most `limit`. Read only.
 */
export interface DuplicateCandidates {
  candidatePairs(
    householdId: string,
    query: { readonly windowDays: number; readonly limit: number },
  ): Promise<{ readonly first: DuplicateSide; readonly second: DuplicateSide }[]>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createDuplicateCandidates(db: ModuleDatabase): DuplicateCandidates {
  return {
    candidatePairs: (householdId, query) =>
      db.inHousehold(householdId, (q) => duplicateCandidates(q, householdId, query)),
  };
}
export type { DuplicateSide };
export type { DuplicateCheck, DuplicatePairSides } from "./application/index.ts";

/**
 * BUD-01@PoC FR 12: the categories the space's split parts use, for module categories («порожня» категорія). Read
 * only. `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`).
 */
export function createTransactionCategoryUsage(db: ModuleDatabase): CategoryUsage {
  return {
    module: "transactions",
    used: (householdId, ids) => db.inHousehold(householdId, (q) => categoriesInParts(q, householdId, ids)),
  };
}

/**
 * The transactions module as module categorization reads it (BUD-01@PoC b; DAT-03@PoC FR 1, FR 2 — the target
 * «транзакції» of «Змінити категорію»; #272 item 1). Read only; every call is bound to one space.
 */
export interface TransactionLookup {
  /** The facts of each existing transaction of `ids` (hidden ones too); the others are absent. */
  facts(
    householdId: string,
    ids: readonly string[],
  ): Promise<
    ReadonlyMap<string, { readonly transfer: boolean; readonly split: boolean; readonly merged: boolean }>
  >;
  /**
   * «Вибрати всі M за фільтром» (DAT-03 FR 1): the transactions the list «Транзакції» shows for `filter` (its syntax and
   * whitelist; shown ones only unless the filter asks for hidden ones), without `excluded`, in the list's default order
   * — at most `limit` — and how many match. An unknown or malformed filter is `invalid`.
   */
  select(
    householdId: string,
    filter: readonly string[],
    excluded: readonly string[],
    limit: number,
  ): Promise<{ readonly ids: readonly string[]; readonly count: number } | { readonly invalid: true }>;
}

/**
 * The transactions module as module budget counts it (BUD-02@PoC FR 12): the shown transactions of the budget's
 * accounts in a period, pending ones too, without transfers between own accounts and merged duplicates; a split one
 * with its parts (a part «На кілька місяців» counts in its month). Read only; every call is bound to one space.
 */
export interface BudgetTransactions {
  inPeriod(
    householdId: string,
    accountIds: readonly string[],
    from: string,
    to: string,
  ): Promise<
    readonly {
      readonly id: string;
      readonly accountId: string;
      readonly amount: Money;
      readonly date: string;
      readonly parts:
        | readonly { readonly categoryId: string; readonly month: string | null; readonly amount: Money }[]
        | null;
    }[]
  >;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createBudgetTransactions(db: ModuleDatabase): BudgetTransactions {
  return {
    inPeriod: (householdId, accountIds, from, to) =>
      db.inHousehold(householdId, (q) => budgetRows(q, householdId, accountIds, from, to)),
  };
}

/**
 * The transactions module as module merchants reads it (BUD-14@PoC a; wave 2 row 22): the counterparty — the bank's
 * description — is the source of a transaction's merchant. Read only; every call is bound to one space.
 */
export interface TransactionTexts {
  /** The counterparty of each existing transaction of `ids` (hidden ones too; null — none); the others are absent. */
  counterparties(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, string | null>>;
  /** Every distinct counterparty of the space's shown transactions and how many have it. */
  counterpartyCounts(
    householdId: string,
  ): Promise<readonly { readonly counterparty: string; readonly count: number }[]>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createTransactionTexts(db: ModuleDatabase): TransactionTexts {
  return {
    counterparties: (householdId, ids) =>
      db.inHousehold(householdId, (q) => counterpartiesOf(q, householdId, ids)),
    counterpartyCounts: (householdId) =>
      db.inHousehold(householdId, (q) => counterpartyCounts(q, householdId)),
  };
}

/**
 * The transactions module as module recurring reads it (BUD-07@PoC FR 1; wave 2 row 25): the space's shown transactions
 * with a counterparty in a period — no side of a transfer, merged into none — newest first, at most `limit`. `amount` is
 * signed in `currency` (minus — an expense). Read only; every call is bound to one space.
 */
export interface TransactionHistory {
  charges(
    householdId: string,
    query: { readonly from: string; readonly to: string; readonly limit: number },
  ): Promise<
    readonly {
      readonly id: string;
      readonly accountId: string;
      readonly date: string;
      readonly amount: string;
      readonly currency: string;
      readonly counterparty: string;
    }[]
  >;
  /**
   * BUD-07@PoC FR 8 (wave 2 row 26): the same, with or without a counterparty — the charges of a regular payment are
   * matched by its category too.
   */
  matching(
    householdId: string,
    query: { readonly from: string; readonly to: string; readonly limit: number },
  ): Promise<
    readonly {
      readonly id: string;
      readonly accountId: string;
      readonly date: string;
      readonly amount: string;
      readonly currency: string;
      readonly counterparty: string | null;
    }[]
  >;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createTransactionHistory(db: ModuleDatabase): TransactionHistory {
  return {
    charges: (householdId, query) =>
      db.inHousehold(householdId, (q) => recurringHistory(q, householdId, query)),
    matching: (householdId, query) =>
      db.inHousehold(householdId, (q) => recurringMatching(q, householdId, query)),
  };
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createTransactionLookup(db: ModuleDatabase): TransactionLookup {
  return {
    facts: (householdId, ids) => db.inHousehold(householdId, (q) => categorizableFacts(q, householdId, ids)),
    async select(householdId, filter, excluded, limit) {
      const filters = filter.some((f) => f.startsWith("hidden."))
        ? [...filter]
        : [...filter, "hidden.eq:false"];
      try {
        return await db.inHousehold(householdId, (q) =>
          transactionsList.ids(q, { filter: filters, sort: "-date" }, { excluded, limit }),
        );
      } catch (error) {
        if (error instanceof ApiProblem && error.code === "VALIDATION_FAILED") return { invalid: true };
        throw error;
      }
    },
  };
}

/**
 * IMP-02@PoC FR 15: the subaccounts the space's transactions are on, for module accounts (a wallet with transactions
 * stays). Read only. `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`).
 */
export function createTransactionWalletUsage(db: ModuleDatabase): WalletUsage {
  return {
    module: "transactions",
    used: (householdId, ids) => db.inHousehold(householdId, (q) => subaccountsInUse(q, householdId, ids)),
  };
}

/**
 * DAT-03@PoC FR 2, BUD-13@PoC FR 2 (src/wiring.ts `bulkActionsServicesFor`): «Додати теги» — the target
 * `transaction-tags` and the action `transactions.add-tags` for module bulk-actions. `db` is the transactions module's
 * own database; `accounts` the accounts module's directory (a closed account's transactions are read only).
 */
export { createTagBulkActions as createTransactionTagBulkActions } from "./adapters/bulk/tags.ts";
