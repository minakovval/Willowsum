// Public interface of the import-sessions module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import type { FileStorage } from "../file-storage/index.ts";
import {
  batchesAudit,
  batchesWorkerQueue,
  fileOriginals,
  importSessionsRoutes,
  requeueDeadHandOffs,
  spaceTx,
} from "./adapters/index.ts";
import { applyHandOff, deleteStaleBatches } from "./application/index.ts";

export const importSessionsModule = defineModule({
  name: "import-sessions",
  publishes: [],
  consumes: [],
  routes: importSessionsRoutes,
});

export { createImportSessionsServices, HAND_OFF_JOB, type ImportSessionsServices } from "./adapters/index.ts";
export { BATCH_LIMITS, BATCH_STATES, canMove, UNAPPLIED_RETENTION_DAYS } from "./domain/index.ts";
export type { BatchState } from "./domain/index.ts";

/** The worker's import-sessions queue (ARC-04 FR 2, FR 3; src/wiring.ts): the audit hand-off jobs (FR 21). */
export function createImportSessionsWorkerQueue(
  db: ModuleDatabase,
  audit: Pick<AuditLog, "record">,
): WorkerQueue {
  return batchesWorkerQueue(db, batchesAudit(audit));
}

/** The scheduler's daily recovery of the hand-off (ARC-04 FR 4, #249): dead hand-off jobs go back to the queue. */
export function createImportSessionsHandOffRecovery(
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

/**
 * The scheduler's daily cleanup (IMP-01@PoC FR 20, AC9; IMP-19@PoC FR 6, AC2): in every space, unapplied batches 30
 * days after their last action go with their originals; applied and rolled-back ones stay. Returns how many went.
 */
export function createImportSessionsCleanup(options: {
  readonly db: ModuleDatabase;
  readonly files: Pick<FileStorage, "store" | "remove" | "link" | "open">;
  readonly audit: Pick<AuditLog, "record">;
  readonly households: () => Promise<readonly string[]>;
  readonly now: () => number;
  readonly newId: () => string;
}): { run(): Promise<number> } {
  const originals = fileOriginals(options.files);
  const audit = batchesAudit(options.audit);
  const deps = { newId: options.newId, now: () => new Date(options.now()) };
  return {
    async run() {
      let deleted = 0;
      for (const householdId of await options.households()) {
        const { result, handOffs } = await deleteStaleBatches(
          deps,
          spaceTx(options.db, householdId),
          originals,
          householdId,
        );
        deleted += result;
        // The entries right away; a failure leaves them to the worker (the jobs are queued).
        for (const h of handOffs) await applyHandOff(audit, householdId, h).catch(() => undefined);
      }
      return deleted;
    },
  };
}
