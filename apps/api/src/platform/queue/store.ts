import type { HouseholdQueryRunner, ModuleDatabase } from "../db/module-db.ts";
import { insertJob, type NewJob } from "./outbox.ts";

/**
 * The storage of one module's job queue and outbox (ARC-04 FR 1). The worker and the modules depend only on this
 * interface; `postgresJobStore` keeps both in the module's own PostgreSQL schema (no message broker). A managed
 * queue can replace it without changes in the modules: they keep calling `publishEvent`, `enqueueJob` and their
 * handlers.
 */
export interface ClaimedJob {
  readonly id: string;
  readonly householdId: string;
  readonly name: string;
  readonly key: string;
  readonly payload: unknown;
  /** This run's number, 1…MAX_ATTEMPTS. */
  readonly attempt: number;
  readonly heavy: boolean;
  readonly traceparent: string | null;
}

/** A job whose last attempt ended with its worker (the lease ran out): moved to the dead-letter queue on claim. */
export interface ExhaustedJob {
  readonly name: string;
  readonly attempts: number;
}

export interface PendingEvent {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly payload: unknown;
  readonly traceparent: string | null;
}

export interface ClaimRequest {
  /** The worker instance that takes the jobs (a random id per process). */
  readonly owner: string;
  /** Only jobs this worker has handlers for. */
  readonly names: readonly string[];
  /** Heavy jobs only, or light jobs only. */
  readonly heavy: boolean;
  readonly limit: number;
  readonly leaseMs: (name: string) => number;
  readonly maxAttempts: number;
}

export interface JobStore {
  readonly module: string;
  claim(
    householdId: string,
    request: ClaimRequest,
  ): Promise<{ claimed: ClaimedJob[]; exhausted: ExhaustedJob[] }>;
  /**
   * Runs `work` and marks the job done in the same household transaction. Throws LeaseLostError (and rolls back
   * the work) if the job is no longer this owner's.
   */
  complete(job: ClaimedJob, owner: string, work: (q: HouseholdQueryRunner) => Promise<void>): Promise<void>;
  /** After a failed run: back to the queue after `delayMs`, or — at `maxAttempts` — to the dead-letter queue. */
  fail(
    job: ClaimedJob,
    owner: string,
    errorClass: string,
    delayMs: number,
    maxAttempts: number,
  ): Promise<"retry" | "dead" | "lost">;
  /** The worker stops: the job goes back to the queue now, without using an attempt. */
  release(job: ClaimedJob, owner: string): Promise<void>;
  enqueue(householdId: string, job: NewJob): Promise<boolean>;
  pendingEvents(householdId: string, limit: number): Promise<PendingEvent[]>;
  markDispatched(householdId: string, ids: readonly string[]): Promise<void>;
}

export class LeaseLostError extends Error {
  constructor() {
    super("The job's lease passed to another worker");
    this.name = "LeaseLostError";
  }
}

/** The error class recorded for a job whose worker ended during its last attempt. */
export const LEASE_EXPIRED = "LeaseExpired";

interface JobRow {
  id: string;
  name: string;
  dedupe_key: string;
  payload: unknown;
  attempts: number;
  state: string;
  heavy: boolean;
  traceparent: string | null;
}

export function postgresJobStore(db: ModuleDatabase): JobStore {
  return {
    module: db.module,

    claim: (householdId, request) =>
      db.inHousehold(householdId, async (q) => {
        // Due jobs and jobs whose worker's lease ran out; SKIP LOCKED: two workers never take the same job. A job
        // that has already had its last attempt goes to the dead-letter queue instead of running a ninth time.
        const { rows } = await q.query<JobRow>(
          `WITH due AS (
             SELECT id FROM jobs
             WHERE household_id = $1 AND name = ANY($2::text[]) AND heavy = $3
               AND ((state = 'queued' AND run_after <= now()) OR (state = 'running' AND lease_until <= now()))
             ORDER BY run_after, created_at
             LIMIT $4
             FOR UPDATE SKIP LOCKED
           )
           UPDATE jobs j SET
             state = CASE WHEN j.attempts >= $5 THEN 'dead' ELSE 'running' END,
             attempts = CASE WHEN j.attempts >= $5 THEN j.attempts ELSE j.attempts + 1 END,
             lease_owner = CASE WHEN j.attempts >= $5 THEN NULL ELSE $6::uuid END,
             lease_until = NULL,
             finished_at = CASE WHEN j.attempts >= $5 THEN now() ELSE NULL END,
             last_error = CASE WHEN j.attempts >= $5 THEN '${LEASE_EXPIRED}' ELSE j.last_error END
           FROM due WHERE j.household_id = $1 AND j.id = due.id
           RETURNING j.id, j.name, j.dedupe_key, j.payload, j.attempts, j.state, j.heavy, j.traceparent`,
          [q.householdId, request.names, request.heavy, request.limit, request.maxAttempts, request.owner],
        );
        const claimed: ClaimedJob[] = [];
        const exhausted: ExhaustedJob[] = [];
        for (const row of rows) {
          if (row.state === "dead") {
            exhausted.push({ name: row.name, attempts: row.attempts });
            continue;
          }
          claimed.push({
            id: row.id,
            householdId: q.householdId,
            name: row.name,
            key: row.dedupe_key,
            payload: row.payload,
            attempt: row.attempts,
            heavy: row.heavy,
            traceparent: row.traceparent,
          });
        }
        // Each job's lease by its own length (an import holds its job longer than a light job).
        for (const job of claimed)
          await q.query(
            `UPDATE jobs SET lease_until = now() + make_interval(secs => $3::double precision / 1000)
             WHERE household_id = $1 AND id = $2`,
            [q.householdId, job.id, request.leaseMs(job.name)],
          );
        return { claimed, exhausted };
      }),

    complete: (job, owner, work) =>
      db.inHousehold(job.householdId, async (q) => {
        await work(q);
        const done = await q.query(
          `UPDATE jobs SET state = 'done', finished_at = now(), lease_owner = NULL, lease_until = NULL
           WHERE household_id = $1 AND id = $2 AND state = 'running' AND lease_owner = $3`,
          [q.householdId, job.id, owner],
        );
        if (done.rowCount !== 1) throw new LeaseLostError();
      }),

    fail: (job, owner, errorClass, delayMs, maxAttempts) =>
      db.inHousehold(job.householdId, async (q) => {
        const { rows } = await q.query<{ state: string }>(
          `UPDATE jobs SET
             state = CASE WHEN attempts >= $4 THEN 'dead' ELSE 'queued' END,
             run_after = now() + make_interval(secs => $5::double precision / 1000),
             finished_at = CASE WHEN attempts >= $4 THEN now() ELSE NULL END,
             lease_owner = NULL, lease_until = NULL, last_error = $6
           WHERE household_id = $1 AND id = $2 AND state = 'running' AND lease_owner = $3
           RETURNING state`,
          [q.householdId, job.id, owner, maxAttempts, delayMs, errorClass.slice(0, 64)],
        );
        if (rows.length === 0) return "lost" as const;
        return rows[0]!.state === "dead" ? ("dead" as const) : ("retry" as const);
      }),

    release: (job, owner) =>
      db.inHousehold(job.householdId, async (q) => {
        await q.query(
          `UPDATE jobs SET state = 'queued', attempts = greatest(attempts - 1, 0), run_after = now(),
             lease_owner = NULL, lease_until = NULL
           WHERE household_id = $1 AND id = $2 AND state = 'running' AND lease_owner = $3`,
          [q.householdId, job.id, owner],
        );
      }),

    enqueue: (householdId, job) => db.inHousehold(householdId, (q) => insertJob(q, job)),

    pendingEvents: (householdId, limit) =>
      db.inHousehold(householdId, async (q) => {
        const { rows } = await q.query<{
          id: string;
          event_name: string;
          event_version: number;
          payload: unknown;
          traceparent: string | null;
        }>(
          `SELECT id, event_name, event_version, payload, traceparent FROM outbox_events
           WHERE household_id = $1 AND dispatched_at IS NULL ORDER BY created_at, id LIMIT $2`,
          [q.householdId, limit],
        );
        return rows.map((r) => ({
          id: r.id,
          name: r.event_name,
          version: r.event_version,
          payload: r.payload,
          traceparent: r.traceparent,
        }));
      }),

    markDispatched: (householdId, ids) =>
      db.inHousehold(householdId, async (q) => {
        await q.query(
          `UPDATE outbox_events SET dispatched_at = now()
           WHERE household_id = $1 AND id = ANY($2::uuid[]) AND dispatched_at IS NULL`,
          [q.householdId, ids],
        );
      }),
  };
}
