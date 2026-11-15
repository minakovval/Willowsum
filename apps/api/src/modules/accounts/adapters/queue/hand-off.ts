import type { HouseholdQueryRunner, ModuleDatabase } from "../../../../platform/db/module-db.ts";
import { defineJobHandler, postgresJobStore, type WorkerQueue } from "../../../../platform/queue/index.ts";
import { applyHandOff, type AccountKinds, type HandOffDeps } from "../../application/index.ts";
import { accountsTx } from "../db/store.ts";
import { HAND_OFF_JOB } from "./job.ts";

/**
 * The account's kind with its row locked, in an accounts transaction: the worker's own (the job's), or — right after
 * the commit — a new one of the route's.
 */
export function accountKinds(
  inTransaction: <T>(work: (q: HouseholdQueryRunner) => Promise<T>) => Promise<T>,
): AccountKinds {
  return {
    whileLocked: (householdId, accountId, work) =>
      inTransaction(async (q) => {
        const account = await accountsTx(q).lockAccount(householdId, accountId);
        return work(account?.kind ?? null);
      }),
  };
}

/**
 * The worker's accounts queue (src/wiring.ts): the store in the accounts schema and the hand-off's handler, which runs
 * in the worker's accounts transaction and calls the other modules through their public interfaces.
 */
export function accountsWorkerQueue(db: ModuleDatabase, deps: HandOffDeps): WorkerQueue {
  return {
    store: postgresJobStore(db),
    handlers: [
      defineJobHandler({
        job: HAND_OFF_JOB,
        run: (job, q) =>
          applyHandOff(
            deps,
            accountKinds((work) => work(q)),
            job.householdId,
            job.payload,
          ),
      }),
    ],
  };
}

/**
 * ARC-04 FR 4 gives a job 8 attempts (about 21 minutes); a hand-off that used them all — another module was away for
 * longer — must still be finished, or the account stays without its ledger account, «Початковий залишок», liability
 * and audit entry for good, and the retention cleanup later deletes the only copy of the amount (the job's payload).
 * So the scheduler puts the space's dead hand-off jobs back in the queue once a day, before that cleanup
 * (src/wiring.ts, `accounts.hand-off-recovery`): the worker tries them again, with an «error» event each time they
 * are dead-lettered, until they are done. Every step is idempotent, so trying again writes nothing twice.
 */
export async function requeueDeadHandOffs(db: ModuleDatabase, householdId: string): Promise<number> {
  return db.inHousehold(householdId, async (q) => {
    const requeued = await q.query(
      `UPDATE jobs SET state = 'queued', attempts = 0, run_after = now(), finished_at = NULL,
              lease_owner = NULL, lease_until = NULL
        WHERE household_id = $1 AND name = $2 AND state = 'dead'`,
      [q.householdId, HAND_OFF_JOB.name],
    );
    return requeued.rowCount ?? 0;
  });
}
