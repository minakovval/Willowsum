import type { HouseholdQueryRunner, ModuleDatabase } from "../../../../platform/db/module-db.ts";
import {
  defineJobHandler,
  postgresJobStore,
  requeueDeadJobs,
  type WorkerQueue,
} from "../../../../platform/queue/index.ts";
import { applyHandOff, type HandOffDeps, type TransactionRows } from "../../application/index.ts";
import { transactionsTx } from "../db/store.ts";
import { HAND_OFF_JOB } from "./job.ts";

/**
 * The transaction's row locked, in a transactions transaction: the worker's own (the job's), or — right after the
 * commit — a new one of the route's.
 */
export function transactionRows(
  inTransaction: <T>(work: (q: HouseholdQueryRunner) => Promise<T>) => Promise<T>,
): TransactionRows {
  return {
    whileLocked: (householdId, transactionId, work) =>
      inTransaction(async (q) => {
        const tx = transactionsTx(q);
        return work(await tx.lock(householdId, transactionId), (id) => tx.find(householdId, id));
      }),
  };
}

/**
 * The worker's transactions queue (src/wiring.ts): the store in the transactions schema and the hand-off's handler,
 * which runs in the worker's transactions transaction and calls the other modules through their public interfaces.
 */
export function transactionsWorkerQueue(db: ModuleDatabase, deps: HandOffDeps): WorkerQueue {
  return {
    store: postgresJobStore(db),
    handlers: [
      defineJobHandler({
        job: HAND_OFF_JOB,
        run: (job, q) =>
          applyHandOff(
            deps,
            transactionRows((work) => work(q)),
            job.householdId,
            job.payload,
          ),
      }),
    ],
  };
}

/**
 * The scheduler's daily recovery (src/wiring.ts, `transactions.hand-off-recovery`; as accounts', ADR-0015): the space's
 * dead hand-off jobs go back in the queue before the retention cleanup, so no transaction stays without its journal
 * event and audit entry for good. Every step is idempotent, so trying again writes nothing twice.
 */
export function requeueDeadHandOffs(db: ModuleDatabase, householdId: string): Promise<number> {
  return requeueDeadJobs(db, householdId, HAND_OFF_JOB.name);
}
