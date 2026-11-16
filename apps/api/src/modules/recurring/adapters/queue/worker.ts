import { randomUUID } from "node:crypto";
import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import {
  defineJobHandler,
  postgresJobStore,
  requeueDeadJobs,
  type WorkerQueue,
} from "../../../../platform/queue/index.ts";
import { applyCategoryMerge, applyHandOff, type RecurringAudit } from "../../application/index.ts";
import { recurringTx } from "../db/store.ts";
import { CATEGORY_MERGED_JOB, HAND_OFF_JOB } from "./job.ts";

/**
 * The worker's recurring queue (src/wiring.ts): the store in the recurring schema, the hand-off's handler — the audit
 * entry through the audit log's public interface (ADR-0015), holding the job's row lock, so the space's erasure waits for
 * it and a job whose row was erased writes nothing (as liabilities', #270) — and the category merge's.
 */
export function recurringWorkerQueue(db: ModuleDatabase, audit: RecurringAudit): WorkerQueue {
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
      // The payments move with their hand-offs in the job's transaction; the worker writes their audit entries next.
      defineJobHandler({
        job: CATEGORY_MERGED_JOB,
        run: (job, q) => applyCategoryMerge(randomUUID, recurringTx(q), job.householdId, job.payload),
      }),
    ],
  };
}

/**
 * The scheduler's daily recovery (`recurring.hand-off-recovery`, ADR-0015, #249): the space's dead jobs — hand-offs and
 * merges — go back in the queue before the retention cleanup. Both are idempotent (a keyed entry; a merge moves only
 * what still has the merged category).
 */
export async function requeueDeadRecurringJobs(db: ModuleDatabase, householdId: string): Promise<number> {
  return (
    (await requeueDeadJobs(db, householdId, HAND_OFF_JOB.name)) +
    (await requeueDeadJobs(db, householdId, CATEGORY_MERGED_JOB.name))
  );
}
