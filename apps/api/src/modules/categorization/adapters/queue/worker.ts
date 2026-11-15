import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import {
  defineJobHandler,
  postgresJobStore,
  requeueDeadJobs,
  type WorkerQueue,
} from "../../../../platform/queue/index.ts";
import { applyHandOff, applyMerge, type CategoryAudit } from "../../application/index.ts";
import { categorizationTx } from "../db/store.ts";
import { CATEGORY_MERGED_JOB, HAND_OFF_JOB } from "./job.ts";

/**
 * The worker's categorization queue (src/wiring.ts): the store in the categorization schema, the hand-off's handler
 * (the audit entry through the audit log's public interface, ADR-0015, holding the job's row lock) and the merge's.
 */
export function categorizationWorkerQueue(db: ModuleDatabase, audit: CategoryAudit): WorkerQueue {
  return {
    store: postgresJobStore(db),
    handlers: [
      defineJobHandler({
        job: HAND_OFF_JOB,
        run: async (job, q) => {
          // As liabilities' (#270 item 2): the space's erasure, which deletes the queue rows, waits for this lock, and a
          // job whose row it took already writes nothing into the erased space.
          const { rowCount } = await q.query(
            `SELECT 1 FROM jobs WHERE household_id = $1 AND id = $2 FOR UPDATE`,
            [job.householdId, job.id],
          );
          if (!rowCount) return;
          await applyHandOff(audit, job.householdId, job.payload);
        },
      }),
      defineJobHandler({
        job: CATEGORY_MERGED_JOB,
        run: async (job, q) => {
          await applyMerge(categorizationTx(q), job.householdId, job.payload);
        },
      }),
    ],
  };
}

/**
 * The scheduler's daily recovery (src/wiring.ts, `categorization.recovery`; ADR-0015, #249): the space's dead jobs —
 * hand-offs and merges — go back in the queue before the retention cleanup. Both are idempotent (a keyed entry; a
 * merge moves only what still has the merged category).
 */
export async function requeueDeadJobsOf(db: ModuleDatabase, householdId: string): Promise<number> {
  return (
    (await requeueDeadJobs(db, householdId, HAND_OFF_JOB.name)) +
    (await requeueDeadJobs(db, householdId, CATEGORY_MERGED_JOB.name))
  );
}
