// Public interface of the categorization module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { EventSubscription, WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import type { BulkActionHandler, BulkTarget } from "../bulk-actions/index.ts";
import { categoryMerged, type CategoryDirectory, type CategoryUsage } from "../categories/index.ts";
import type { TransactionLookup } from "../transactions/index.ts";
import {
  CATEGORY_MERGED_JOB,
  categorizationAudit,
  categorizationRoutes,
  categorizationTx,
  categorizationWorkerQueue,
  eraseHouseholdCategorization,
  HAND_OFF_JOB,
  requeueDeadJobsOf,
  setCategoryAction,
  transactionsCategoryTarget,
} from "./adapters/index.ts";
import { categoriesInUse } from "./application/index.ts";

export const categorizationModule = defineModule({
  name: "categorization",
  publishes: [],
  consumes: [categoryMerged],
  routes: categorizationRoutes,
});

export { createCategorizationServices, type CategorizationServices } from "./adapters/index.ts";
export { SET_CATEGORY_ACTION, TRANSACTIONS_ENTITY } from "./adapters/index.ts";
export { CATEGORY_SOURCES, pickCategory, proposalApplies } from "./domain/index.ts";
export type { CategorySource, TransactionCategory } from "./domain/index.ts";

/** The categorization queue's jobs (ARC-04): the audit hand-off of a change, and «Категорію об'єднано» (BUD-01 FR 8). */
export { CATEGORY_MERGED_JOB, HAND_OFF_JOB };

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
 * audit log as the routes') and the jobs of «Категорію об'єднано». `db` is the categorization database.
 */
export function createCategorizationWorkerQueue(
  db: ModuleDatabase,
  audit: Pick<AuditLog, "record">,
): WorkerQueue {
  return categorizationWorkerQueue(db, categorizationAudit(audit));
}

/** BUD-01 FR 8: module categories' «Категорію об'єднано» becomes a categorization job (src/wiring.ts). */
export const categorizationSubscriptions: readonly EventSubscription[] = [
  { event: categoryMerged, consumer: "categorization", job: CATEGORY_MERGED_JOB },
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

/** Erasure of a space's categorization (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface CategorizationErasure {
  eraseHousehold(
    householdId: string,
  ): Promise<{ readonly transactionCategories: number; readonly jobs: number }>;
}

export function createCategorizationErasure(db: ModuleDatabase): CategorizationErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdCategorization(db, householdId) };
}
