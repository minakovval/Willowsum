// Public interface of the categorization module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { EventSubscription, WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import type { BulkActionHandler, BulkTarget } from "../bulk-actions/index.ts";
import { categoryMerged, type CategoryDirectory, type CategoryUsage } from "../categories/index.ts";
import type { AccountDirectory } from "../accounts/index.ts";
import type { MerchantDirectory } from "../merchants/index.ts";
import {
  transactionCreated,
  transactionImportMerged,
  type TransactionImportMerged,
  type TransactionLookup,
  type TransactionRuleInputs,
  type TransactionRuleTags,
} from "../transactions/index.ts";
import {
  AUDIT_JOB,
  CATEGORY_MERGED_JOB,
  RULE_RUN_PART_JOB,
  categorizationAudit,
  categorizationRoutes,
  categorizationTx,
  categorizationWorkerQueue,
  eraseHouseholdCategorization,
  HAND_OFF_JOB,
  IMPORT_MERGED_JOB,
  requeueDeadJobsOf,
  setCategoryAction,
  TRANSACTION_CREATED_JOB,
  transactionsCategoryTarget,
} from "./adapters/index.ts";
import { carryImportMerged, categoriesInUse, type RuleDeps } from "./application/index.ts";

export const categorizationModule = defineModule({
  name: "categorization",
  publishes: [],
  consumes: [categoryMerged, transactionCreated, transactionImportMerged],
  routes: categorizationRoutes,
});

export { createCategorizationServices, type CategorizationServices } from "./adapters/index.ts";
export { SET_CATEGORY_ACTION, TRANSACTIONS_ENTITY } from "./adapters/index.ts";
export { CATEGORY_SOURCES, pickCategory, proposalApplies, RULES_MAX } from "./domain/index.ts";
export { RULE_SCAN_MAX } from "./adapters/index.ts";
export type { CategorySource, TransactionCategory } from "./domain/index.ts";

/**
 * The categorization queue's jobs (ARC-04): the audit hand-off of a change, «Категорію об'єднано» (BUD-01 FR 8), the
 * rules of a new transaction and the audit entries of the rules (BUD-14 FR 8), the category of a merge on import
 * (IMP-04 FR 5).
 */
export {
  AUDIT_JOB,
  CATEGORY_MERGED_JOB,
  HAND_OFF_JOB,
  IMPORT_MERGED_JOB,
  RULE_RUN_PART_JOB,
  TRANSACTION_CREATED_JOB,
};

/**
 * IMP-04@PoC FR 5 (#658): the bank's row takes the category of the manual transaction merged into it on apply — the
 * port `merged` of module transactions' `createImportedTransactions` (src/main.ts, src/wiring.ts), run right after the
 * apply commits; the job of `transactions.import-merged` runs it again if this failed. `db` is the categorization
 * database.
 */
export function createImportCategoryCarry(
  db: ModuleDatabase,
): (householdId: string, merge: TransactionImportMerged) => Promise<void> {
  return async (householdId, merge) => {
    await db.inHousehold(householdId, (q) => carryImportMerged(categorizationTx(q), householdId, merge));
  };
}

/** At most this many transactions per read of `createTransactionCategoryRead` (the rest in the next one). */
const CATEGORY_READ_CHUNK = 1000;

/**
 * IMP-16@PoC FR 4 (wave 2 row 44): the categories of the transactions `ids` (their category and source; absent — «Без
 * категорії» never set) — the port `categories` of module transactions' `createImportedTransactions`: a category set
 * «вручну» keeps a transaction of a rolled-back batch. Read only, in chunks of 1 000 on the primary key.
 */
export function createTransactionCategoryRead(
  db: ModuleDatabase,
): (
  householdId: string,
  ids: readonly string[],
) => Promise<ReadonlyMap<string, { readonly categoryId: string | null; readonly source: string }>> {
  return async (householdId, ids) => {
    const out = new Map<string, { categoryId: string | null; source: string }>();
    for (let i = 0; i < ids.length; i += CATEGORY_READ_CHUNK) {
      const chunk = ids.slice(i, i + CATEGORY_READ_CHUNK);
      const read = await db.inHousehold(householdId, (q) => categorizationTx(q).read(householdId, chunk));
      for (const [id, c] of read) out.set(id, { categoryId: c.categoryId, source: c.source });
    }
    return out;
  };
}

/** The ports of the category rules (BUD-14 b) — other modules' public interfaces, as the rules read them. */
export type CategorizationRulePorts = Omit<RuleDeps, "categories">;

/**
 * BUD-14 b: the rules' ports from module accounts' directory (an account exists in the space), module merchants'
 * directory (the shown merchant name of a counterparty), module transactions' rule inputs and, for the tags action
 * (BUD-14 b2), module transactions' rule tags — without them the rules add no tags (src/main.ts, src/wiring.ts).
 */
export function categorizationRulePorts(deps: {
  readonly accounts: AccountDirectory;
  readonly merchants: MerchantDirectory;
  readonly inputs: TransactionRuleInputs;
  readonly tags?: TransactionRuleTags;
}): CategorizationRulePorts {
  return {
    ...(deps.tags ? { tags: deps.tags } : {}),
    accounts: {
      exists: async (householdId, accountId) =>
        (await deps.accounts.postingAccount(householdId, accountId)) !== null,
    },
    merchants: {
      async names(householdId, counterparties) {
        const shown = await deps.merchants.shownMerchants(householdId, counterparties);
        return new Map([...shown].map(([counterparty, m]) => [counterparty, m.name]));
      },
      async knownNames(householdId, counterparties) {
        const known = await deps.merchants.knownMerchants(householdId, counterparties);
        return new Map([...known].map(([counterparty, m]) => [counterparty, m.name]));
      },
    },
    inputs: deps.inputs,
  };
}

/**
 * BUD-01@PoC FR 12: the categories that existing transactions of the space have as their own category, for module
 * categories («порожня» категорія). Read only; `db` is the categorization database, `transactions` module
 * transactions' lookup (a row of a deleted transaction is no use).
 */
export function createCategorizationCategoryUsage(
  db: ModuleDatabase,
  transactions: Pick<TransactionLookup, "facts">,
): CategoryUsage {
  return {
    module: "categorization",
    used: (householdId, ids) =>
      db.inHousehold(householdId, (q) =>
        categoriesInUse(categorizationTx(q), transactions, householdId, ids),
      ),
  };
}

/**
 * DAT-03@PoC FR 2, AC1 (#272 item 1): the bulk target «transactions» and the action «Змінити категорію»
 * (`transactions.set-category`), for `createBulkActionsServices` (src/wiring.ts). `db` is the categorization database.
 */
export function createCategoryBulkActions(deps: {
  readonly db: ModuleDatabase;
  readonly transactions: TransactionLookup;
  readonly categories: Pick<CategoryDirectory, "category">;
}): { readonly targets: readonly BulkTarget[]; readonly actions: readonly BulkActionHandler[] } {
  return {
    targets: [transactionsCategoryTarget(deps)],
    actions: [setCategoryAction(deps)],
  };
}

/**
 * The worker's categorization queue (ARC-04; src/wiring.ts): the hand-off jobs (audit entries of changes, with the same
 * audit log as the routes'), the jobs of «Категорію об'єднано», the rules of a new transaction and the rules' audit
 * entries. `db` is the categorization database.
 */
export function createCategorizationWorkerQueue(
  db: ModuleDatabase,
  audit: Pick<AuditLog, "record">,
  categories: Pick<CategoryDirectory, "category">,
  rules: CategorizationRulePorts,
  /** The flag runtime (CICD-06): without it the rules apply to no new transaction (fails closed). */
  flags?: { isEnabled(householdId: string, flag: string): Promise<boolean> },
  /** BUD-14 FR 7: when a background run ends (default: the system clock). */
  clock: { now(): number } = { now: () => Date.now() },
): WorkerQueue {
  return categorizationWorkerQueue(db, categorizationAudit(audit), categories, {
    deps: { ...rules, categories },
    audit,
    enabled: async (householdId) => (flags ? flags.isEnabled(householdId, "categorization.rules") : false),
    clock,
  });
}

/**
 * BUD-01 FR 8: module categories' «Категорію об'єднано», BUD-14 FR 8: module transactions' «Нова транзакція» and
 * IMP-04 FR 5: its «Злито з імпортом» become categorization jobs (src/wiring.ts).
 */
export const categorizationSubscriptions: readonly EventSubscription[] = [
  { event: categoryMerged, consumer: "categorization", job: CATEGORY_MERGED_JOB },
  { event: transactionCreated, consumer: "categorization", job: TRANSACTION_CREATED_JOB },
  { event: transactionImportMerged, consumer: "categorization", job: IMPORT_MERGED_JOB },
];

/**
 * The scheduler's daily recovery (ARC-04 FR 2–4, #249; src/wiring.ts): puts the categorization jobs the worker gave up
 * on (`dead`) back in the queue. Returns how many went back. Idempotent.
 */
export function createCategorizationRecovery(
  db: ModuleDatabase,
  households: () => Promise<readonly string[]>,
): { run(): Promise<number> } {
  return {
    async run() {
      let requeued = 0;
      for (const householdId of await households()) requeued += await requeueDeadJobsOf(db, householdId);
      return requeued;
    },
  };
}

/**
 * The categories of transactions as module budget counts them (BUD-02@PoC FR 9, FR 12): the category of each of `ids`
 * that has one; an absent id is «Без категорії». Read only; every call is bound to one space.
 */
export interface TransactionCategories {
  categoriesOf(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/** `db` is the categorization module's own database (`ModuleDatabases.for("categorization")`). */
export function createTransactionCategories(db: ModuleDatabase): TransactionCategories {
  return {
    categoriesOf: (householdId, ids) =>
      db.inHousehold(householdId, async (q) => {
        const rows = await categorizationTx(q).read(householdId, ids);
        const out = new Map<string, string>();
        for (const [id, row] of rows) if (row.categoryId !== null) out.set(id, row.categoryId);
        return out;
      }),
  };
}

/** Erasure of a space's categorization (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface CategorizationErasure {
  eraseHousehold(
    householdId: string,
  ): Promise<{ readonly transactionCategories: number; readonly jobs: number }>;
}

export function createCategorizationErasure(db: ModuleDatabase): CategorizationErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdCategorization(db, householdId) };
}
