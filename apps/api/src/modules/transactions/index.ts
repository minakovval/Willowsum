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
  paymentsToAccounts,
  budgetFirstDate,
  budgetRows,
  transfersDatedIn,
  categoriesInParts,
  transactionsWithPartIn,
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
  transactionsTx,
  transferCandidates,
  counterpartCandidates,
  duplicateCandidates,
  importBatchTransactions,
  importCandidates,
  importRollbackTx,
  importWriteTx,
  transactionRows,
  ruleCandidates,
  ruleInputsOf,
  reviewQueueMembers,
  reviewQueueSlices,
  type CandidateSide,
  type ChosenSide,
  type CounterpartSide,
  type DuplicateSide,
  type ImportCandidate,
  type ImportCandidatesQuery,
  type ImportBatchTransaction,
  type ImportBatchTransactionsQuery,
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
import { transferDifference } from "./domain/index.ts";
import { transactionCreated, transactionImportMerged, type TransactionImportMerged } from "./events.ts";
import {
  applyHandOff,
  markTransfer,
  ROLLBACK_RECOVERY_LISTED,
  previewRollback,
  rollbackImport,
  rolledBackImport,
  settleImport,
  writeImport,
  type HandOffDeps,
  type ImportCounts,
  type ImportPlanContext,
  type ImportWriteInput,
  type ImportWriteResult,
  type ImportRollbackInput,
  type ImportRollbackResult,
  type RollbackCategory,
  type RollbackPreview,
  type TransferDeps,
} from "./application/index.ts";
import { logEvent } from "../../platform/telemetry/signals.ts";

export const transactionsModule = defineModule({
  name: "transactions",
  publishes: [transactionCreated, transactionImportMerged],
  consumes: [],
  routes: transactionsRoutes,
});

export {
  transactionCreated,
  transactionImportMerged,
  type TransactionCreated,
  type TransactionImportMerged,
} from "./events.ts";

export {
  createTransactionsServices,
  type CategoryTransactions,
  type TransactionsServices,
} from "./adapters/index.ts";
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
 * by its rule which are proposals: a debit and a credit on two accounts of the space (or on two wallets of one account
 * in two currencies — an exchange, IMP-03 FR 2) within `windowDays`, both posted,
 * shown, not split and in no transfer; in one currency the credit at most the debit and at least `sameCurrencyMinShare`
 * of it. Newest first, at most `limit`. Read only.
 */
export interface TransferCandidates {
  candidatePairs(
    householdId: string,
    query: { readonly windowDays: number; readonly sameCurrencyMinShare: string; readonly limit: number },
  ): Promise<{ readonly outflow: CandidateSide; readonly inflow: CandidateSide }[]>;
  /**
   * IMP-03@PoC FR 24 («Позначити як переказ»): the transaction `transactionId` of the space (null `chosen` — none) and
   * the free transactions of the opposite direction on another account (or another currency of its account) within
   * `windowDays` before or after it, in its currency within `amountShare` of its amount, in another any amount; posted,
   * shown, not split, in no transfer. By the days apart, then the difference of the amounts; at most `limit`. Read only.
   */
  counterpartsOf(
    householdId: string,
    transactionId: string,
    query: { readonly windowDays: number; readonly amountShare: string; readonly limit: number },
  ): Promise<{ readonly chosen: ChosenSide | null; readonly items: readonly CounterpartSide[] }>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createTransferCandidates(db: ModuleDatabase): TransferCandidates {
  return {
    candidatePairs: (householdId, query) =>
      db.inHousehold(householdId, (q) => transferCandidates(q, householdId, query)),
    counterpartsOf: (householdId, transactionId, query) =>
      db.inHousehold(householdId, (q) => counterpartCandidates(q, householdId, transactionId, query)),
  };
}
export type { CandidateSide, ChosenSide, CounterpartSide };

/**
 * BUD-01@PoC FR 7, AC4 (#722 D): «Позначити як переказ» of a pair for module transfer-matching's card payments — the
 * same mark as the route's (application markTransfer: both rows locked, the accounts' money locks, the journal's
 * transfer event, the audit entry of each side by `actorAccountId`, the person whose import or entry brought the pair),
 * its hand-offs run right away (the worker runs them otherwise). True — marked; false — refused (a side changed, in
 * another transfer or of another space, an account closed, no rate): nothing changed. `db` is the transactions
 * module's own database.
 */
export interface TransferMarking {
  mark(householdId: string, actorAccountId: string, outflowId: string, inflowId: string): Promise<boolean>;
}

export function createTransferMarking(
  db: ModuleDatabase,
  ports: {
    readonly accounts: HandOffDeps["accounts"];
    readonly ledger: HandOffDeps["ledger"];
    readonly audit: Pick<AuditLog, "record">;
    readonly newId: () => string;
    readonly rates: TransferDeps["rates"];
  },
): TransferMarking {
  const deps: TransferDeps = {
    accounts: ports.accounts,
    ledger: ports.ledger,
    audit: transactionAudit(ports.audit),
    newId: ports.newId,
    rates: ports.rates,
    // Not read by the mark: no date is typed, no status set, nothing hidden.
    today: () => {
      throw new Error("the transfer mark reads no date");
    },
    statesEnabled: () => Promise.resolve(false),
    duplicates: null,
  };
  return {
    async mark(householdId, actorAccountId, outflowId, inflowId) {
      const result = await markTransfer(
        deps,
        (work) => db.inHousehold(householdId, (q) => work(transactionsTx(q))),
        { householdId, accountId: actorAccountId },
        outflowId,
        inflowId,
      );
      if (result.kind !== "ok") return false;
      try {
        for (const h of result.handOffs)
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
      return true;
    },
  };
}

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

/**
 * IMP-08@PoC FR 11, AC7 (the step «Результат»): the transactions an applied import batch wrote that a category is asked
 * of — shown, not split, no side of a transfer — for module import-sessions, which asks module categorization which of
 * them have one. One page in the order of the batch's rows after `after`, at most `limit`, on the index by batch and
 * row. Read only; ids only.
 */
export interface ImportBatchTransactions {
  page(householdId: string, query: ImportBatchTransactionsQuery): Promise<readonly ImportBatchTransaction[]>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createImportBatchTransactions(db: ModuleDatabase): ImportBatchTransactions {
  return {
    page: (householdId, query) =>
      db.inHousehold(householdId, (q) => importBatchTransactions(q, householdId, query)),
  };
}
export type { ImportBatchTransaction, ImportBatchTransactionsQuery };

export {
  IMPORT_WAITERS_MAX,
  ImportBusy,
  importedRate,
  importedText,
  importedValueDate,
  ImportWriteRefused,
  ImportWriteVoided,
  ImportRollbackBusy,
  ROLLBACK_KEPT_LISTED,
  ROLLBACK_RECOVERY_LISTED,
  ROLLBACK_MODES,
  type ImportRollbackCounts,
  type ImportRollbackInput,
  type ImportRollbackResult,
  type RollbackCategory,
  type RollbackMode,
  type RollbackPreview,
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
  /**
   * IMP-04 FR 8, IMP-16 FR 1–5 (wave 2 row 44): «Відкотити» the batch in one transaction under the import lock and the
   * money lock of its accounts — each transaction of it rolled back (hidden, its journal event reversed, never
   * deleted), kept when the person changed it («Залишити змінені») or it is a side of a transfer; what was merged into a
   * rolled-back one comes back. Once per batch (`first` false: rolled back before, nothing now). A closed account —
   * `ImportWriteRefused`; a row held by another change — `ImportRollbackBusy`; nothing changed either way. Throws when
   * the port `categories` was not given.
   */
  rollback(householdId: string, input: ImportRollbackInput): Promise<ImportRollbackResult>;
  /** The batch's rollback as recorded; null — not rolled back. Read only. */
  rolledBack(householdId: string, batchId: string): Promise<Omit<ImportRollbackResult, "first"> | null>;
  /**
   * IMP-16@PoC FR 4 (owner, 2026-11-26, decision 13): what the rollback dialog says before it is confirmed — how many
   * transactions the rollback takes, how many the person changed after the apply (kept with «Залишити змінені вручну»)
   * and how many are sides of a transfer; null — rolled back already. Read only, unlocked. Throws when the port
   * `categories` was not given.
   */
  rollbackPreview(householdId: string, batchId: string): Promise<RollbackPreview | null>;
  /**
   * The rollbacks recorded in `[since, before)` (at most `ROLLBACK_RECOVERY_LISTED`, earliest first), for module
   * import-sessions' recovery of a request that ended before it marked its batch. Read only.
   */
  rolledBackSince(
    householdId: string,
    since: Date,
    before: Date,
  ): Promise<readonly (Omit<ImportRollbackResult, "first"> & { readonly batchId: string })[]>;
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
    /**
     * IMP-04 FR 5 (#658): run right away after the write for each merge with a manual transaction (module
     * categorization carries its category); the event `transactions.import-merged` makes it happen later too.
     */
    readonly merged?: (householdId: string, merge: TransactionImportMerged) => Promise<void>;
    /**
     * IMP-16 FR 4 (wave 2 row 44): module categorization's categories of the transactions `ids` — a category set by
     * hand after the apply keeps a transaction with «Залишити змінені». Without it the rollback throws.
     */
    readonly categories?: (
      householdId: string,
      ids: readonly string[],
    ) => Promise<ReadonlyMap<string, RollbackCategory>>;
  },
): ImportedTransactions {
  const deps: HandOffDeps = {
    accounts: ports.accounts,
    ledger: ports.ledger,
    audit: transactionAudit(ports.audit),
  };
  return {
    async write(householdId, input, plan) {
      const { handOffs, merges, ...result } = await db.inHousehold(householdId, (q) =>
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
      // FR 5 (#658): the manual ones' categories right away; the event's job does it if this fails.
      for (const m of ports.merged ? merges : [])
        await ports.merged!(householdId, { ...m, actorAccountId: input.actorId }).catch((error: unknown) =>
          logEvent("transactions.import_merge_deferred", "warn", {
            "ws.module": "transactions",
            "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
          }),
        );
      return result;
    },
    settle: (householdId, input) =>
      db.inHousehold(householdId, (q) =>
        settleImport({ now: () => new Date(ports.now()) }, importWriteTx(q), householdId, input),
      ),
    async rollback(householdId, input) {
      const categories = ports.categories;
      if (!categories) throw new Error("the rollback needs module categorization's categories");
      const { handOffs, ...result } = await db.inHousehold(householdId, (q) =>
        rollbackImport(
          { accounts: ports.accounts, now: () => new Date(ports.now()), categories },
          importRollbackTx(q),
          householdId,
          input,
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
    rolledBack: (householdId, batchId) =>
      db.inHousehold(householdId, (q) => rolledBackImport(importRollbackTx(q), householdId, batchId)),
    rollbackPreview(householdId, batchId) {
      const categories = ports.categories;
      if (!categories) throw new Error("the rollback preview needs module categorization's categories");
      return db.inHousehold(householdId, (q) =>
        previewRollback({ categories }, importRollbackTx(q), householdId, batchId),
      );
    },
    rolledBackSince: (householdId, since, before) =>
      db.inHousehold(householdId, (q) =>
        importRollbackTx(q).rolledBackSince(householdId, since, before, ROLLBACK_RECOVERY_LISTED),
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
    // BUD-02@PoC FR 23: the split transactions with a part in the category, for «N транзакцій».
    transactions: (householdId, categoryId) =>
      db.inHousehold(householdId, (q) => transactionsWithPartIn(q, householdId, categoryId)),
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
        | readonly {
            readonly categoryId: string;
            readonly month: string | null;
            readonly amount: Money;
            /**
             * FIN-03@PoC FR 8, AC31: a transfer's gain against the official rate — income of the budget under its
             * category («Комісії банку», an expense category), never a refund of it. Absent — counted by the category.
             */
            readonly asIncome?: boolean;
          }[]
        | null;
      /**
       * BUD-06@PoC FR 8 «Одноразова витрата»: counted in the fact of its period, left out of the averages (BUD-06 FR 4,
       * BUD-02 «Створити за моїми витратами») — the reader decides. Always false while `transactions.one-off` is off
       * for the space (the mark then acts nowhere); absent — not marked.
       */
      readonly oneOff?: boolean;
    }[]
  >;
  /**
   * BUD-06@PoC FR 4, FR 5: the date of the first transaction these accounts have that `inPeriod` would count — where
   * the space's history starts (an average counts whole months after it; «Минулий рік» needs data there); null — none.
   */
  firstDate(householdId: string, accountIds: readonly string[]): Promise<string | null>;
}

/**
 * BUD-06@PoC FR 8: whether «Одноразова витрата» (`transactions.one-off`) is on for the space — the API process wires the
 * flag runtime; left out (a test's server), the marks act.
 */
export interface OneOffSwitch {
  readonly oneOffEnabled?: (householdId: string) => Promise<boolean>;
}

/**
 * FIN-03@PoC FR 8 (owner, 2026-11-26, decision 11): the space's «Комісії банку» (module categories, system key
 * `bank-fees`) — the category the budget counts a transfer's fee and currency difference in; null — none. Left out (a
 * test's server): the budget counts no transfer's difference.
 */
export interface TransferDifferenceCategory {
  readonly feeCategory?: (householdId: string) => Promise<string | null>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createBudgetTransactions(
  db: ModuleDatabase,
  options: OneOffSwitch & TransferDifferenceCategory = {},
): BudgetTransactions {
  return {
    async inPeriod(householdId, accountIds, from, to) {
      const own = await db.inHousehold(householdId, (q) => budgetRows(q, householdId, accountIds, from, to));
      const rows = [...own, ...(await transferDifferences(db, options, householdId, accountIds, from, to))];
      if (!rows.some((r) => r.oneOff) || (await oneOffOn(options, householdId))) return rows;
      return rows.map((r) => ({ ...r, oneOff: false }));
    },
    firstDate: (householdId, accountIds) =>
      db.inHousehold(householdId, (q) => budgetFirstDate(q, householdId, accountIds)),
  };
}

/**
 * FIN-03@PoC FR 8, AC31; IMP-03@PoC FR 9, FR 21 (owner, 2026-11-26, decision 11): each marked transfer of the dates
 * whose fee (one currency, on the debit's account) or currency difference (two currencies, on the credit's account) is
 * on one of `accountIds` — one row, a part in «Комісії банку», dated by the transfer (edge case 1): negative an expense,
 * positive an income of the budget. The sides themselves stay out (budgetRows). `id` is the transfer's.
 */
async function transferDifferences(
  db: ModuleDatabase,
  options: TransferDifferenceCategory,
  householdId: string,
  accountIds: readonly string[],
  from: string,
  to: string,
) {
  if (!options.feeCategory || accountIds.length === 0) return [];
  const transfers = await db.inHousehold(householdId, (q) => transfersDatedIn(q, householdId, from, to));
  const accounts = new Set(accountIds);
  const differences = transfers.flatMap((t) => {
    const d = transferDifference(t.outflow, t.inflow, t.rate);
    if (d === null) return [];
    const accountId = d.side === "outflow" ? t.outflow.accountId : t.inflow.accountId;
    return accounts.has(accountId) ? [{ id: t.id, accountId, amount: d.amount, date: t.date }] : [];
  });
  if (differences.length === 0) return [];
  const categoryId = await options.feeCategory(householdId);
  if (categoryId === null) return [];
  // A loss is spending in «Комісії банку»; a gain is income under the same category (FIN-03 AC31).
  return differences.map((d) => ({
    ...d,
    parts: [
      {
        categoryId,
        month: null,
        amount: d.amount,
        ...(d.amount.isNegative() ? {} : { asIncome: true }),
      },
    ],
    oneOff: false,
  }));
}

async function oneOffOn(options: OneOffSwitch, householdId: string): Promise<boolean> {
  return options.oneOffEnabled ? options.oneOffEnabled(householdId) : true;
}

/**
 * The transactions module as module goals reads it (BUD-05@PoC FR 8, FR 10). Read only; every call is bound to one
 * space.
 */
export interface GoalTransactions {
  /**
   * FR 10 «Подушка безпеки»: the space's transactions from `from` to `to` as the budget period counts them — shown,
   * «Очікує» too, no merged duplicate, no side of a transfer, any account; signed, with split parts; `oneOff` — marked
   * «Одноразова витрата» (BUD-06@PoC FR 8; false while `transactions.one-off` is off).
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
export function createGoalTransactions(db: ModuleDatabase, options: OneOffSwitch = {}): GoalTransactions {
  return {
    async countedInWindow(householdId, from, to) {
      // BUD-06@PoC FR 8: «Одноразова витрата» leaves the sum of «Подушка безпеки» (BUD-05 FR 10), not its months.
      const oneOffs = await oneOffOn(options, householdId);
      return db.inHousehold(householdId, (q) => countedInWindow(q, householdId, from, to, oneOffs));
    },
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
 * BUD-07@PoC FR 16 as module recurring reads it: the payments to these accounts (a loan's) in the dates (YYYY-MM-DD,
 * both included) — as `AccountPayments` counts them — oldest first. Read only; bound to one space.
 */
export interface AccountInflows {
  inflows(
    householdId: string,
    accountIds: readonly string[],
    from: string,
    to: string,
  ): Promise<
    readonly { readonly accountId: string; readonly transactionId: string; readonly date: string }[]
  >;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createAccountInflows(db: ModuleDatabase): AccountInflows {
  return {
    inflows: (householdId, accountIds, from, to) =>
      db.inHousehold(householdId, (q) => paymentsToAccounts(q, householdId, accountIds, from, to)),
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
