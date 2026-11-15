import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import {
  defineJobHandler,
  postgresJobStore,
  requeueDeadJobs,
  type WorkerQueue,
} from "../../../../platform/queue/index.ts";
import { applyHandOff, type LiabilityAudit } from "../../application/index.ts";
import { HAND_OFF_JOB } from "./job.ts";

/**
 * The worker's liabilities queue (src/wiring.ts): the store in the liabilities schema and the hand-off's handler, which
 * writes the audit entry through the audit log's public interface (ADR-0015).
 */
export function liabilitiesWorkerQueue(db: ModuleDatabase, audit: LiabilityAudit): WorkerQueue {
  return {
    store: postgresJobStore(db),
    handlers: [
      defineJobHandler({
        job: HAND_OFF_JOB,
        run: (job) => applyHandOff(audit, job.householdId, job.payload),
      }),
    ],
  };
}

/**
 * The scheduler's daily recovery (src/wiring.ts, `liabilities.hand-off-recovery`; as accounts', ADR-0015): the space's
 * dead hand-off jobs go back in the queue before the retention cleanup, so no liability stays without its audit entry
 * for good. The entry is keyed, so trying again writes nothing twice.
 */
export function requeueDeadHandOffs(db: ModuleDatabase, householdId: string): Promise<number> {
  return requeueDeadJobs(db, householdId, HAND_OFF_JOB.name);
}
