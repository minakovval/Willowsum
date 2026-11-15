// Public interface of the bulk-actions module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import {
  bulkActionsRoutes,
  bulkActionsWorkerQueue,
  eraseHouseholdBulkActions,
  requeueDeadBulkJobs,
  type BulkActionsServices,
} from "./adapters/index.ts";

export const bulkActionsModule = defineModule({
  name: "bulk-actions",
  publishes: [],
  consumes: [],
  routes: bulkActionsRoutes,
});

export { createBulkActionsServices, PART_SIZE, type BulkActionsServices } from "./adapters/index.ts";
export { AUDIT_JOB, RUN_PART_JOB, UNDO_JOB } from "./adapters/index.ts";
export {
  bulkRegistry,
  type BulkActionHandler,
  type BulkCaller,
  type BulkRecord,
  type BulkTarget,
  type BulkWrite,
} from "./application/index.ts";
export {
  BULK_ITEMS_MAX,
  FOREGROUND_MAX,
  UNDO_WINDOW_MS,
  type BulkValues,
  type PlannedChange,
} from "./domain/index.ts";

/**
 * The worker's bulk-actions queue (ARC-04; src/wiring.ts): the parts of background runs, undos and group audit
 * entries, with the same services as the routes'. `db` is the bulk-actions database.
 */
export function createBulkActionsWorkerQueue(db: ModuleDatabase, services: BulkActionsServices): WorkerQueue {
  return bulkActionsWorkerQueue(db, services.deps, services.audit);
}

/**
 * The scheduler's daily recovery (ARC-04 FR 4; src/wiring.ts): the bulk-actions jobs the worker gave up on go back in
 * the queue. Returns how many went back. Idempotent.
 */
export function createBulkActionsRecovery(
  db: ModuleDatabase,
  households: () => Promise<readonly string[]>,
): { run(): Promise<number> } {
  return {
    async run() {
      let requeued = 0;
      for (const householdId of await households()) requeued += await requeueDeadBulkJobs(db, householdId);
      return requeued;
    },
  };
}

/** Erasure of a space's bulk actions (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface BulkActionsErasure {
  eraseHousehold(
    householdId: string,
  ): Promise<{ readonly actions: number; readonly idempotencyKeys: number; readonly jobs: number }>;
}

/** `db` is the bulk-actions module's own database (`ModuleDatabases.for("bulk-actions")`). */
export function createBulkActionsErasure(db: ModuleDatabase): BulkActionsErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdBulkActions(db, householdId) };
}
