import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import {
  defineJobHandler,
  postgresJobStore,
  requeueDeadJobs,
  type WorkerQueue,
} from "../../../../platform/queue/index.ts";
import { applyHandOff, type GoalsAudit } from "../../application/index.ts";
import { HAND_OFF_JOB } from "./job.ts";

/**
 * The worker's goals queue (src/wiring.ts): the store in the goals schema and the hand-off's handler, which writes the
 * audit entry through the audit log's public interface (ADR-0015), holding the job's row lock — so the space's erasure,
 * which deletes the queue rows, waits for it, and a job whose row was erased writes nothing (as liabilities', #270).
 */
export function goalsWorkerQueue(db: ModuleDatabase, audit: GoalsAudit): WorkerQueue {
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

/** The scheduler's daily recovery (`goals.hand-off-recovery`, ADR-0015): the space's dead hand-offs go back in the queue. */
export function requeueDeadHandOffs(db: ModuleDatabase, householdId: string): Promise<number> {
  return requeueDeadJobs(db, householdId, HAND_OFF_JOB.name);
}
