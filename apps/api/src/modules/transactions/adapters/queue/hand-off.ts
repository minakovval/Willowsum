import type { HouseholdQueryRunner, ModuleDatabase } from "../../../../platform/db/module-db.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import {
  defineJobHandler,
  postgresJobStore,
  requeueDeadJobs,
  type WorkerQueue,
} from "../../../../platform/queue/index.ts";
import {
  applyHandOff,
  type HandOffDeps,
  type TransactionHandOff,
  type TransactionRows,
} from "../../application/index.ts";
import { transactionsTx } from "../db/store.ts";
import { HAND_OFF_JOB, TAG_AUDIT_JOB } from "./job.ts";

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
        const row = await tx.lock(householdId, transactionId);
        // #257 item 3: a deleted row has nothing to lock, so two hand-offs of it (the route's and the worker's, or two
        // of the worker's) could reverse the same entries at once; they take turns on the transaction's id instead.
        if (row === null)
          await q.query(
            `SELECT pg_advisory_xact_lock(hashtextextended('transactions.hand-off:' || $1 || ':' || $2, 0))`,
            [householdId, transactionId],
          );
        return work(row, (id) => tx.find(householdId, id));
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
      // BUD-13 FR 2: a tag's audit entry, by its key (written once).
      defineJobHandler({
        job: TAG_AUDIT_JOB,
        run: (job) => deps.audit.tagChanged(job.householdId, job.payload),
      }),
    ],
  };
}

/**
 * The scheduler's daily recovery (src/wiring.ts, `transactions.hand-off-recovery`; as accounts', ADR-0015): the space's
 * dead hand-off jobs (and tag audit jobs) go back in the queue before the retention cleanup, so no transaction stays without its journal
 * event and audit entry for good. Every step is idempotent, so trying again writes nothing twice.
 */
export async function requeueDeadHandOffs(db: ModuleDatabase, householdId: string): Promise<number> {
  return (
    (await requeueDeadJobs(db, householdId, HAND_OFF_JOB.name)) +
    // BUD-13 FR 2: the audit entries of tag changes, the same way.
    (await requeueDeadJobs(db, householdId, TAG_AUDIT_JOB.name))
  );
}

/** At most this many unfinished hand-offs are finished for one closing; more — the closing is refused (try again later). */
const SETTLE_LIMIT = 100;

/**
 * The unfinished hand-offs (`queued`, `running` or `dead`) that may still move money on the account (FIN-01@PoC EC4):
 * those of a transaction on it now, of one that was on it before the change (a delete or a move: the audit values'
 * `accountId`), and of a side of a transfer whose other side is on it (the outflow's hand-off posts the transfer event
 * to both accounts). A transfer's mark removed needs no more: the inflow's own hand-off reverses that event as well. A
 * job that finished is not read again: the route's own run, if it succeeded, left the journal as the worker's would.
 */
async function pendingHandOffsOn(
  q: HouseholdQueryRunner,
  householdId: string,
  accountId: string,
): Promise<readonly { readonly id: string; readonly payload: unknown }[]> {
  const { rows } = await q.query<{ id: string; payload: unknown }>(
    `SELECT j.id::text AS id, j.payload FROM jobs j
      WHERE j.household_id = $1 AND j.name = $3 AND j.state IN ('queued', 'running', 'dead')
        AND (
          EXISTS (SELECT 1 FROM transactions t
                   WHERE t.household_id = j.household_id AND t.id::text = j.payload->>'transactionId'
                     AND t.account_id = $2)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(j.payload->'audit') a
                      WHERE a->>'field' = 'accountId' AND lower($2::text) IN (a->>'before', a->>'after'))
          OR EXISTS (SELECT 1 FROM transactions t
                       JOIN transfers f ON f.household_id = t.household_id AND f.id = t.transfer_id
                       JOIN transactions o ON o.household_id = f.household_id
                                          AND o.id IN (f.outflow_id, f.inflow_id) AND o.id <> t.id
                      WHERE t.household_id = j.household_id AND t.id::text = j.payload->>'transactionId'
                        AND o.account_id = $2)
        )
      ORDER BY j.created_at, j.id
      LIMIT ${SETTLE_LIMIT + 1}`,
    [householdId, accountId, HAND_OFF_JOB.name],
  );
  return rows;
}

/**
 * FIN-01@PoC EC4, FIN-12@PoC FR 7 (module accounts' `PendingPostings`, src/main.ts): before an account closes, the
 * hand-offs of the space's transactions that may still move its money are run now — each the worker's own step,
 * idempotent, with the transaction's row locked — so the closing reads the balance they leave. False when one of them
 * cannot finish now (it stays in the queue for the worker): null, and the closing is refused, never made past a posting
 * to come. Else the ids of the jobs it ran (they may stay queued: the worker's run of them changes nothing more), for
 * `unsettledAccountHandOffs` under the account's lock. Only the space's rows are read (`inHousehold`: the row policy
 * binds the space).
 */
export async function settleAccountHandOffs(
  db: ModuleDatabase,
  deps: HandOffDeps,
  householdId: string,
  accountId: string,
): Promise<readonly string[] | null> {
  try {
    const jobs = await db.inHousehold(householdId, (q) => pendingHandOffsOn(q, householdId, accountId));
    if (jobs.length > SETTLE_LIMIT) return null;
    const rows = transactionRows((work) => db.inHousehold(householdId, work));
    for (const job of jobs) {
      // The payload as the worker reads it: checked by the job's schema.
      const handOff: TransactionHandOff = HAND_OFF_JOB.schema.parse(job.payload);
      await applyHandOff(deps, rows, householdId, handOff);
    }
    return jobs.map((j) => j.id);
  } catch (error) {
    logEvent("transactions.hand_off_deferred", "warn", {
      "ws.module": "transactions",
      "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
    });
    return null;
  }
}

/**
 * Row 198 (#409 items 1 and 4), read by module accounts under the account's money lock (`lockAccounts`), which every
 * write of this module on the account holds until it commits: whether an unfinished hand-off that may move the
 * account's money is not among `settled` — a change committed after `settleAccountHandOffs` read the queue, so the
 * balance in the journal does not count it yet. A read of this module's queue only.
 */
export async function unsettledAccountHandOffs(
  db: ModuleDatabase,
  householdId: string,
  accountId: string,
  settled: readonly string[],
): Promise<boolean> {
  const done = new Set(settled);
  const jobs = await db.inHousehold(householdId, (q) => pendingHandOffsOn(q, householdId, accountId));
  return jobs.some((j) => !done.has(j.id));
}
