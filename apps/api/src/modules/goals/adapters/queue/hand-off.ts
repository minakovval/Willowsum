import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import {
  defineJobHandler,
  postgresJobStore,
  requeueDeadJobs,
  type WorkerQueue,
} from "../../../../platform/queue/index.ts";
import { applyHandOff, cancelSpendsOfEntries, type GoalsAudit } from "../../application/index.ts";
import { goalsTx } from "../db/store.ts";
import type { Ledger } from "../../../ledger/index.ts";
import { ENTRY_RECORDED_JOB, HAND_OFF_JOB, SPEND_CHECK_JOB } from "./job.ts";

/**
 * The worker's goals queue (src/wiring.ts): the store in the goals schema and the hand-off's handler, which writes the
 * audit entry through the audit log's public interface (ADR-0015), holding the job's row lock — so the space's erasure,
 * which deletes the queue rows, waits for it, and a job whose row was erased writes nothing (as liabilities', #270).
 */
export function goalsWorkerQueue(
  db: ModuleDatabase,
  audit: GoalsAudit,
  newId: () => string,
  ledger: Pick<Ledger, "liveEntries">,
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
      // AC5: the spends of a reversed transaction event are cancelled with their hand-offs in the job's transaction;
      // the worker writes their audit entries next.
      defineJobHandler({
        job: ENTRY_RECORDED_JOB,
        run: async (job, q) => {
          const e = job.payload;
          if (e.eventType !== "reversal" || e.sourceModule !== "transactions" || e.reversesEntryId === null)
            return;
          await cancelSpendsOfEntries({ newId }, goalsTx(q), job.householdId, [e.reversesEntryId]);
        },
      }),
      // #306 item 2: a spend whose transaction's event is no longer in effect is cancelled (the request's own check
      // after the commit can be lost).
      defineJobHandler({
        job: SPEND_CHECK_JOB,
        run: async (job, q) => {
          const { transactionId, entryId } = job.payload;
          const live = await ledger.liveEntries(
            job.householdId,
            { module: "transactions", id: transactionId },
            "transaction",
          );
          if (live.some((e) => e.id === entryId)) return;
          await cancelSpendsOfEntries({ newId }, goalsTx(q), job.householdId, [entryId]);
        },
      }),
    ],
  };
}

/**
 * The scheduler's daily recovery (`goals.hand-off-recovery`, ADR-0015, #249): the space's dead jobs — hand-offs,
 * spend checks and reversed journal events — go back in the queue. Both are idempotent (a keyed entry; a cancelled spend is gone).
 */
export async function requeueDeadHandOffs(db: ModuleDatabase, householdId: string): Promise<number> {
  return (
    (await requeueDeadJobs(db, householdId, HAND_OFF_JOB.name)) +
    (await requeueDeadJobs(db, householdId, ENTRY_RECORDED_JOB.name)) +
    (await requeueDeadJobs(db, householdId, SPEND_CHECK_JOB.name))
  );
}
