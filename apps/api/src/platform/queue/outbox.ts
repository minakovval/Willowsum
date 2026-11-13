import { readFileSync } from "node:fs";
import type { z } from "zod";
import type { HouseholdQueryRunner } from "../db/module-db.ts";
import type { EventDefinition } from "../events/define.ts";
import { jobTraceCarrier } from "../telemetry/jobs.ts";
import { DEDUPE_KEY_MAX, type JobDefinition } from "./define.ts";

/** The migration every module that publishes events or runs jobs adds to its schema, verbatim (ARC-04). */
export const QUEUE_TABLES_SQL = readFileSync(new URL("./queue-tables.sql", import.meta.url), "utf8");

/**
 * ARC-04 FR 2: publishes an event in the caller's own transaction (the module's `outbox_events` table). It is
 * dispatched only if that transaction commits; a rolled-back change publishes nothing. The payload is checked
 * by the event's schema. Returns the event id.
 */
export async function publishEvent<S extends z.ZodType>(
  q: HouseholdQueryRunner,
  event: EventDefinition<S>,
  payload: z.infer<S>,
): Promise<string> {
  const checked: unknown = event.schema.parse(payload);
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO outbox_events (household_id, event_name, event_version, payload, traceparent)
     VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
    [
      q.householdId,
      event.name,
      event.version,
      JSON.stringify(checked),
      jobTraceCarrier()?.traceparent ?? null,
    ],
  );
  return rows[0]!.id;
}

/**
 * ARC-04 FR 3: enqueues a job in the caller's own transaction (the module's `jobs` table). The same key for the
 * same job in the same household is one job: a second enqueue does nothing and returns false.
 */
export async function enqueueJob<S extends z.ZodType>(
  q: HouseholdQueryRunner,
  job: JobDefinition<S>,
  key: string,
  payload: z.infer<S>,
): Promise<boolean> {
  return insertJob(q, {
    name: job.name,
    key,
    payload: job.schema.parse(payload),
    heavy: job.heavy === true,
    traceparent: jobTraceCarrier()?.traceparent ?? null,
  });
}

export interface NewJob {
  readonly name: string;
  readonly key: string;
  readonly payload: unknown;
  readonly heavy: boolean;
  readonly traceparent: string | null;
}

export async function insertJob(q: HouseholdQueryRunner, job: NewJob): Promise<boolean> {
  if (job.key.length < 1 || job.key.length > DEDUPE_KEY_MAX)
    throw new Error(`A job key has 1–${DEDUPE_KEY_MAX} characters`);
  const result = await q.query(
    `INSERT INTO jobs (household_id, name, dedupe_key, payload, heavy, traceparent)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (household_id, name, dedupe_key) DO NOTHING`,
    [q.householdId, job.name, job.key, JSON.stringify(job.payload ?? null), job.heavy, job.traceparent],
  );
  return result.rowCount === 1;
}
