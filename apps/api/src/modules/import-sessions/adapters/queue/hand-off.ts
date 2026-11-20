import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import {
  defineJobHandler,
  postgresJobStore,
  requeueDeadJobs,
  type WorkerQueue,
} from "../../../../platform/queue/index.ts";
import {
  applyHandOff,
  runParse,
  type BatchesAudit,
  type BatchesDeps,
  type ParsePorts,
} from "../../application/index.ts";
import { batchesTx } from "../db/store.ts";
import { HAND_OFF_JOB, PARSE_FILE_JOB } from "./job.ts";

/**
 * The worker's import-sessions queue (src/wiring.ts): the hand-off's handler writes the audit entry through the audit
 * log's public interface (ADR-0015), holding the job's row lock, so a job whose row was erased writes nothing.
 */
export function batchesWorkerQueue(
  db: ModuleDatabase,
  audit: BatchesAudit,
  /** The parse step's ports (src/wiring.ts, where the worker has file storage); without them no parse job is taken. */
  parse?: { readonly ports: ParsePorts; readonly deps: BatchesDeps },
): WorkerQueue {
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
      ...(parse
        ? [
            defineJobHandler({
              job: PARSE_FILE_JOB,
              // The job's own transaction holds the file's parse row; its audit hand-offs are queued in it, so a
              // rolled-back parse leaves no entry and the worker writes them once it committed (ADR-0015).
              run: async (job, q) => {
                await runParse(parse.deps, batchesTx(q), parse.ports, job.householdId, job.payload);
              },
            }),
          ]
        : []),
    ],
  };
}

/**
 * The scheduler's daily recovery (`import-sessions.hand-off-recovery`, ADR-0015, #249): dead hand-offs go back, and
 * dead parses too — a batch never stays «в обробці» for good.
 */
export async function requeueDeadHandOffs(db: ModuleDatabase, householdId: string): Promise<number> {
  return (
    (await requeueDeadJobs(db, householdId, HAND_OFF_JOB.name)) +
    (await requeueDeadJobs(db, householdId, PARSE_FILE_JOB.name))
  );
}
