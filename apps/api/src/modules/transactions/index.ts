// Public interface of the transactions module (ARC-01 FR 2). Other modules import only this file.
import type { Money } from "@willowsum/domain-kernel";
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import type { PendingPostings, WalletUsage } from "../accounts/index.ts";
import type { CategoryUsage } from "../categories/index.ts";
import { ApiProblem } from "../../platform/http/problem.ts";
import {
  accountsPaidIn,
  budgetFirstDate,
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
  settleAccountHandOffs,
  unsettledAccountHandOffs,
  transactionAudit,
  transactionsList,
  transactionsRoutes,
  transactionsWorkerQueue,
  transferCandidates,
  duplicateCandidates,
  importCandidates,
  importWriteTx,
  transactionRows,
  ruleCandidates,
  ruleInputsOf,
  reviewQueueMembers,
  reviewQueueSlices,
  type CandidateSide,
  type DuplicateSide,
  type ImportCandidate,
  type ImportCandidatesQuery,
  type RuleInput,
} from "./adapters/index.ts";
import {
  countedInWindow,
  spendCandidates,
  type CountedTransaction,
  type SpendCandidate,
  type SpendCandidatesAfter,
} from "./adapters/db/goal-reads.ts";
import {
  operationsOnAccounts,
  transfersInPeriod,
  type AccountOperation,
  type MovementSide,
} from "./adapters/db/cashflow-reads.ts";
import { transactionCreated } from "./events.ts";
import {
  applyHandOff,
  settleImport,
  writeImport,
  type HandOffDeps,
  type ImportCounts,
  type ImportPlanContext,
  type ImportWriteInput,
  type ImportWriteResult,
} from "./application/index.ts";
import { logEvent } from "../../platform/telemetry/signals.ts";

export const transactionsModule = defineModule({
  name: "transactions",
  publishes: [transactionCreated],
  consumes: [],
  routes: transactionsRoutes,
});

export { transactionCreated, type TransactionCreated } from "./events.ts";

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
 * IMP-04@PoC FR 1–6 (wave 2 row 43): the transactions of one account in a date window for module duplicate-matching's
 * plan of an import batch — hidden ones too, never a merged duplicate; one page in the order of (date, id) after
 * `after`, at most `limit`, on the index by account and date. Read only.
 */
export interface ImportCandidates {
  page(householdId: string, query: ImportCandidatesQuery): Promise<readonly ImportCandidate[]>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createImportCandidates(db: ModuleDatabase): ImportCandidates {
  return {
    page: (householdId, query) => db.inHousehold(householdId, (q) => importCandidates(q, householdId, query)),
  };
}
export type { ImportCandidate, ImportCandidatesQuery };

export {
  IMPORT_WAITERS_MAX,
  ImportBusy,
  importedText,
  ImportWriteRefused,
  ImportWriteVoided,
  type ImportCounts,
  type ImportCreated,
  type ImportedRowInput,
  type ImportPlanContext,
  type ImportWriteInput,
  type ImportWriteIssue,
  type ImportWriteResult,
} from "./application/index.ts";

/**
 * IMP-01@PoC FR 11, IMP-04@PoC FR 7, AC9 (#637): the write of an import batch's rows for module import-sessions' apply
 * step — one transaction of this module for the whole batch under the import lock and the money lock of its accounts;
 * `plan` runs inside it (module duplicate-matching's `planImport` on `context.candidates`) and writes each file's rows
 * with `context.create` before the next file is planned. Each row is written once by its key (batch, file, row) and the
 * batch once (`first` false: written before, nothing now, its counts back). An unknown or closed account or a row the
 * account cannot take — `ImportWriteRefused`, nothing written; any error of `plan` rolls everything back too.
 */
export interface ImportedTransactions {
  write(
    householdId: string,
    input: ImportWriteInput,
    plan: (context: ImportPlanContext) => Promise<ImportCounts>,
  ): Promise<ImportWriteResult>;
  /**
   * #654: gives up the attempt unless the batch is written — under the accounts' import lock, so a write in progress
   * finishes first. The counts of the batch's write (the caller finishes its apply with them), or null: the attempt is
   * given up and no write of it can follow (`ImportWriteVoided`).
   */
  settle(
    householdId: string,
    input: Pick<ImportWriteInput, "batchId" | "attemptId" | "accountIds">,
  ): Promise<ImportCounts | null>;
}

/** The hand-offs run right away after the write; the worker runs the rest from the queue (ARC-04 FR 2). */
export const IMPORT_HAND_OFF_NOW = 100;

/** `db` is the transactions module's own database; the ports are the worker's (journal, accounts, audit). */
export function createImportedTransactions(
  db: ModuleDatabase,
  ports: {
    readonly accounts: HandOffDeps["accounts"];
    readonly ledger: HandOffDeps["ledger"];
    readonly audit: Pick<AuditLog, "record">;
    readonly newId: () => string;
    readonly now: () => number;
  },
): ImportedTransactions {
  const deps: HandOffDeps = {
    accounts: ports.accounts,
    ledger: ports.ledger,
    audit: transactionAudit(ports.audit),
  };
  return {
    async write(householdId, input, plan) {
      const { handOffs, ...result } = await db.inHousehold(householdId, (q) =>
        writeImport(
          { accounts: ports.accounts, newId: ports.newId, now: () => new Date(ports.now()) },
          importWriteTx(q),
          householdId,
          input,
          plan,
        ),
      );
      try {
        for (const h of handOffs.slice(0, IMPORT_HAND_OFF_NOW))
          await applyHandOff(
            deps,
            transactionRows((work) => db.inHousehold(householdId, work)),
            householdId,
            h,
          );
      } catch (error) {
        // The jobs are queued: the worker finishes them (class only, never a value).
        logEvent("transactions.hand_off_deferred", "warn", {
          "ws.module": "transactions",
          "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
        });
      }
      return result;
    },
    settle: (householdId, input) =>
      db.inHousehold(householdId, (q) =>
        settleImport({ now: () => new Date(ports.now()) }, importWriteTx(q), householdId, input),
      ),
  };
}

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
  /**
   * BUD-06@PoC FR 4, FR 5: the date of the first transaction these accounts have that `inPeriod` would count — where
   * the space's history starts (an average counts whole months after it; «Минулий рік» needs data there); null — none.
   */
  firstDate(householdId: string, accountIds: readonly string[]): Promise<string | null>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createBudgetTransactions(db: ModuleDatabase): BudgetTransactions {
  return {
    inPeriod: (householdId, accountIds, from, to) =>
      db.inHousehold(householdId, (q) => budgetRows(q, householdId, accountIds, from, to)),
    firstDate: (householdId, accountIds) =>
      db.inHousehold(householdId, (q) => budgetFirstDate(q, householdId, accountIds)),
  };
}

/**
 * The transactions module as module goals reads it (BUD-05@PoC FR 8, FR 10). Read only; every call is bound to one
 * space.
 */
export interface GoalTransactions {
  /**
   * FR 10 «Подушка безпеки»: the space's transactions from `from` to `to` as the budget period counts them — shown,
   * «Очікує» too, no merged duplicate, no side of a transfer, any account; signed, with split parts.
   */
  countedInWindow(householdId: string, from: string, to: string): Promise<readonly CountedTransaction[]>;
  /**
   * FR 8 «Витратити» (#559): a page of the outgoing «Проведена» shown transactions in `currency` (no merged duplicate,
   * no side of a transfer) on `accountId` (null — any account of the space), not in `excluded`, matching `search`;
   * newest first, and how many match in all (without `after`).
   */
  spendCandidates(
    householdId: string,
    query: {
      readonly accountId: string | null;
      readonly currency: string;
      readonly excluded: readonly string[];
      readonly search: string | null;
      /** The page starts after this row; null — the first page. */
      readonly after: SpendCandidatesAfter | null;
      readonly limit: number;
    },
  ): Promise<{ readonly items: readonly SpendCandidate[]; readonly count: number }>;
}

export type { CountedTransaction, SpendCandidate, SpendCandidatesAfter };

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createGoalTransactions(db: ModuleDatabase): GoalTransactions {
  return {
    countedInWindow: (householdId, from, to) =>
      db.inHousehold(householdId, (q) => countedInWindow(q, householdId, from, to)),
    spendCandidates: (householdId, query) =>
      db.inHousehold(householdId, (q) => spendCandidates(q, householdId, query)),
  };
}

/**
 * The transactions module as module cashflow reads it (BUD-08@PoC FR 5–7): the money that moves between own accounts —
 * into goals, investments and loans. Read only; every call is bound to one space.
 */
export interface CashflowMovements {
  /** FR 5, FR 6: the marked transfers between own accounts whose shown outflow is dated from `from` to `to`. */
  transfers(
    householdId: string,
    from: string,
    to: string,
  ): Promise<readonly { readonly outflow: MovementSide; readonly inflow: MovementSide }[]>;
  /** FR 7: the shown transactions of `accountIds` (a loan's) in the dates, sides of a transfer too; oldest first. */
  operations(
    householdId: string,
    accountIds: readonly string[],
    from: string,
    to: string,
  ): Promise<readonly AccountOperation[]>;
}

export type { AccountOperation, MovementSide };

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createCashflowMovements(db: ModuleDatabase): CashflowMovements {
  return {
    transfers: (householdId, from, to) =>
      db.inHousehold(householdId, (q) => transfersInPeriod(q, householdId, from, to)),
    operations: (householdId, accountIds, from, to) =>
      db.inHousehold(householdId, (q) => operationsOnAccounts(q, householdId, accountIds, from, to)),
  };
}

/**
 * BUD-03@PoC FR 5 as module budget reads it: which of these accounts (a loan's) got a payment in the dates (YYYY-MM-DD,
 * both included) — a shown transaction with a positive amount, a side of a transfer too. Read only; bound to one space.
 */
export interface AccountPayments {
  paidIn(
    householdId: string,
    accountIds: readonly string[],
    from: string,
    to: string,
  ): Promise<ReadonlySet<string>>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createAccountPayments(db: ModuleDatabase): AccountPayments {
  return {
    paidIn: (householdId, accountIds, from, to) =>
      db.inHousehold(householdId, (q) => accountsPaidIn(q, householdId, accountIds, from, to)),
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
  /**
   * BUD-12@PoC FR 14 (mode «Мерчанти» of «До розбору»): the queue — shown transactions in it, as its counter counts them
   * — counted and summed (exact NUMERIC, signed) by counterparty and currency in SQL, the oldest first, at most `limit`;
   * `more` — others are beyond them.
   */
  reviewQueueSlices(
    householdId: string,
    limit: number,
  ): Promise<{
    readonly slices: readonly {
      readonly counterparty: string | null;
      readonly currency: string;
      readonly count: number;
      readonly total: string;
      readonly oldest: string;
    }[];
    readonly more: boolean;
  }>;
  /**
   * BUD-12@PoC FR 14, FR 16: the queued transactions (id, counterparty) whose counterparty is one of `counterparties`
   * (with `none`, also those without one), by id after `after`, at most `limit`; `more` — others are beyond them.
   */
  reviewQueueMembers(
    householdId: string,
    query: {
      readonly counterparties: readonly string[];
      readonly none: boolean;
      readonly after: string | null;
      readonly limit: number;
    },
  ): Promise<{
    readonly items: readonly { readonly id: string; readonly counterparty: string | null }[];
    readonly more: boolean;
  }>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createTransactionTexts(db: ModuleDatabase): TransactionTexts {
  return {
    counterparties: (householdId, ids) =>
      db.inHousehold(householdId, (q) => counterpartiesOf(q, householdId, ids)),
    counterpartyCounts: (householdId) =>
      db.inHousehold(householdId, (q) => counterpartyCounts(q, householdId)),
    reviewQueueSlices: (householdId, limit) =>
      db.inHousehold(householdId, (q) => reviewQueueSlices(q, householdId, limit)),
    reviewQueueMembers: (householdId, query) =>
      db.inHousehold(householdId, (q) => reviewQueueMembers(q, householdId, query)),
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
 * FIN-01@PoC EC4, FIN-12@PoC FR 7: the space's transactions whose hand-off to the journal has not finished, for module
 * accounts' closing — run now with the worker's ports (the accounts directory, the journal, the audit log), so the
 * closing reads the balance they leave; false when one cannot finish now (the closing is refused). `db` is the
 * transactions module's own database (`ModuleDatabases.for("transactions")`).
 */
export function createTransactionPendingPostings(
  db: ModuleDatabase,
  ports: {
    readonly accounts: HandOffDeps["accounts"];
    readonly ledger: HandOffDeps["ledger"];
    readonly audit: Pick<AuditLog, "record">;
  },
): PendingPostings {
  const deps: HandOffDeps = {
    accounts: ports.accounts,
    ledger: ports.ledger,
    audit: transactionAudit(ports.audit),
  };
  return {
    module: "transactions",
    settle: (householdId, accountId) => settleAccountHandOffs(db, deps, householdId, accountId),
    unsettled: (householdId, accountId, settled) =>
      unsettledAccountHandOffs(db, householdId, accountId, settled),
  };
}

/**
 * The transactions module as module categorization's category rules read it (BUD-14@PoC FR 5, FR 7, FR 8; wave 2 row
 * 23). Read only; every call is bound to one space.
 */
export interface TransactionRuleInputs {
  /** The inputs of each existing transaction of `ids` (hidden ones too); the others are absent. */
  inputs(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, RuleInput>>;
  /** The eligible transactions, newest first, at most `limit`; `more` — there are others beyond them. */
  candidates(
    householdId: string,
    limit: number,
  ): Promise<{ readonly items: readonly RuleInput[]; readonly more: boolean }>;
}
export type { RuleInput };

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
/**
 * BUD-14@PoC FR 5, FR 7, FR 9 (wave 2 row 23 b2): a category rule's tags on a transaction and their «Відмінити», for
 * module categorization (`categorizationRulePorts`). `db` is the transactions module's own database; `accounts` the
 * accounts module's directory (a closed account's transactions are read only); behind `transactions.attributes`.
 */
export {
  createRuleTags as createTransactionRuleTags,
  type TransactionRuleTags,
} from "./adapters/rules/tags.ts";

export function createTransactionRuleInputs(db: ModuleDatabase): TransactionRuleInputs {
  return {
    inputs: (householdId, ids) => db.inHousehold(householdId, (q) => ruleInputsOf(q, householdId, ids)),
    candidates: (householdId, limit) =>
      db.inHousehold(householdId, (q) => ruleCandidates(q, householdId, limit)),
  };
}

/**
 * DAT-03@PoC FR 2, BUD-13@PoC FR 2 (src/wiring.ts `bulkActionsServicesFor`): «Додати теги» — the target
 * `transaction-tags` and the action `transactions.add-tags` for module bulk-actions. `db` is the transactions module's
 * own database; `accounts` the accounts module's directory (a closed account's transactions are read only).
 */
export { createTagBulkActions as createTransactionTagBulkActions } from "./adapters/bulk/tags.ts";
/**
 * BUD-12@PoC FR 12, FR 14: «Підтвердити категорії» — the target `transaction-review` and the action
 * `transactions.confirm-category` for module bulk-actions (`db`: the transactions module's own database).
 */
export { createReviewBulkActions as createTransactionReviewBulkActions } from "./adapters/bulk/review.ts";
