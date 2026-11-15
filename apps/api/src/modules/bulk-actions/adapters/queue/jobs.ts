import { z } from "zod";
import type { HouseholdQueryRunner, ModuleDatabase } from "../../../../platform/db/module-db.ts";
import {
  defineJob,
  defineJobHandler,
  enqueueJob,
  postgresJobStore,
  requeueDeadJobs,
  type WorkerQueue,
} from "../../../../platform/queue/index.ts";
import type { AuditLog } from "../../../audit/index.ts";
import { runPart, runUndo, writeGroupAudit, type BulkDeps, type BulkJobs } from "../../application/index.ts";
import { bulkStore } from "../db/store.ts";

/**
 * The jobs of a bulk action (ARC-04; DAT-03@PoC FR 6, FR 9–11), in the bulk-actions queue (migrations/0003_queue.sql).
 * Payloads hold identifiers only. Each is idempotent: a part skips the records already done, an undo the records
 * already restored, and the audit entry has its key.
 */
export const RUN_PART_JOB = defineJob({
  name: "bulk-actions.run-part",
  schema: z.strictObject({
    actionId: z.uuid(),
    run: z.number().int().min(1),
    part: z.number().int().min(1).max(1000),
  }),
});
export const UNDO_JOB = defineJob({
  name: "bulk-actions.undo",
  schema: z.strictObject({ actionId: z.uuid() }),
});
export const AUDIT_JOB = defineJob({
  name: "bulk-actions.audit",
  schema: z.strictObject({
    actionId: z.uuid(),
    kind: z.enum(["run", "undo"]),
    run: z.number().int().min(1),
  }),
});

/** The jobs enqueued in the caller's bulk-actions transaction; the same job twice is one. */
export function bulkJobs(q: HouseholdQueryRunner): BulkJobs {
  return {
    async runPart(actionId, run, part) {
      await enqueueJob(q, RUN_PART_JOB, `run:${actionId}:${run}:${part}`, { actionId, run, part });
    },
    async undo(actionId) {
      await enqueueJob(q, UNDO_JOB, `undo:${actionId}`, { actionId });
    },
    async audit(actionId, kind, run) {
      await enqueueJob(q, AUDIT_JOB, `audit:${actionId}:${kind}:${run}`, { actionId, kind, run });
    },
  };
}

/**
 * The worker's bulk-actions queue (src/wiring.ts): the store in the bulk-actions schema and the three handlers, each in
 * the worker's bulk-actions transaction; the records are read and written through the targets (the owning modules'
 * public interfaces) and the group entry through the audit log.
 */
export function bulkActionsWorkerQueue(
  db: ModuleDatabase,
  deps: BulkDeps,
  audit: Pick<AuditLog, "record">,
): WorkerQueue {
  return {
    store: postgresJobStore(db),
    handlers: [
      defineJobHandler({
        job: RUN_PART_JOB,
        run: (job, q) =>
          runPart(deps, bulkStore(q), bulkJobs(q), job.householdId, { ...job.payload, attempt: job.attempt }),
      }),
      defineJobHandler({
        job: UNDO_JOB,
        run: (job, q) => runUndo(deps, bulkStore(q), bulkJobs(q), job.householdId, job.payload.actionId),
      }),
      defineJobHandler({
        job: AUDIT_JOB,
        run: (job, q) => writeGroupAudit(deps, bulkStore(q), audit, job.householdId, job.payload),
      }),
    ],
  };
}

/**
 * The scheduler's daily recovery (src/wiring.ts, `bulk-actions.recovery`; as the transactions hand-off's, ADR-0015):
 * the space's dead jobs of bulk actions go back in the queue before the retention cleanup, so no action stays
 * «running» for good, no undo stays half done and no run stays without its group audit entry. A part taken again
 * from its first attempt goes on where the run stopped.
 */
export async function requeueDeadBulkJobs(db: ModuleDatabase, householdId: string): Promise<number> {
  let requeued = 0;
  for (const job of [RUN_PART_JOB, UNDO_JOB, AUDIT_JOB])
    requeued += await requeueDeadJobs(db, householdId, job.name);
  return requeued;
}
