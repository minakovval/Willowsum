// Public interface of the import-sessions module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import {
  batchesAudit,
  batchesWorkerQueue,
  importSessionsRoutes,
  requeueDeadHandOffs,
} from "./adapters/index.ts";

export const importSessionsModule = defineModule({
  name: "import-sessions",
  publishes: [],
  consumes: [],
  routes: importSessionsRoutes,
});

export { createImportSessionsServices, HAND_OFF_JOB, type ImportSessionsServices } from "./adapters/index.ts";
export { BATCH_LIMITS, BATCH_STATES, canMove } from "./domain/index.ts";
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
