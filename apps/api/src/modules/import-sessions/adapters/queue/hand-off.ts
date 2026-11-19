import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import {
  defineJobHandler,
  postgresJobStore,
  requeueDeadJobs,
  type WorkerQueue,
} from "../../../../platform/queue/index.ts";
import { applyHandOff, type BatchesAudit } from "../../application/index.ts";
import { HAND_OFF_JOB } from "./job.ts";

/**
 * The worker's import-sessions queue (src/wiring.ts): the hand-off's handler writes the audit entry through the audit
 * log's public interface (ADR-0015), holding the job's row lock, so a job whose row was erased writes nothing.
 */
export function batchesWorkerQueue(db: ModuleDatabase, audit: BatchesAudit): WorkerQueue {
  return {
    store: postgresJobStore(db),
    handlers: [
      defineJobHandler({
        job: HAND_OFF_JOB,
        run: async (job, q) => {
          const { rowCount } = await q.query(
            `SELECT 1 FROM jobs WHERE household_id = $1 AND id = $2 FOR UPDATE`,
            [job.householdId, job.id],
          );
          if (!rowCount) return;
          await applyHandOff(audit, job.householdId, job.payload);
        },
      }),
    ],
  };
}

/** The scheduler's daily recovery (`import-sessions.hand-off-recovery`, ADR-0015, #249): dead hand-offs go back. */
export function requeueDeadHandOffs(db: ModuleDatabase, householdId: string): Promise<number> {
  return requeueDeadJobs(db, householdId, HAND_OFF_JOB.name);
}
