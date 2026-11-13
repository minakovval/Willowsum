import type { z } from "zod";
import type { HouseholdQueryRunner } from "../db/module-db.ts";

/**
 * Background jobs (ARC-04, NFR-05 FR 6). A job belongs to one module and one household; its payload is checked
 * by a schema when it is enqueued and again when it runs. Every job must be idempotent (FR 3): a job runs
 * at least once, and its effects in the module's database commit in the same transaction that marks it done,
 * so a failed or interrupted run leaves nothing behind and the retry gives the same result.
 */
export interface JobDefinition<S extends z.ZodType = z.ZodType> {
  /** `<module>.<job>` in kebab-case, e.g. `import-sessions.parse-file`. */
  readonly name: string;
  readonly schema: S;
  /** A heavy job (an import): the worker runs at most `heavyLimit` of them at a time, across all spaces (FR 5). */
  readonly heavy?: boolean;
  /** How long a worker holds the job before another may take it (default DEFAULT_LEASE_MS). */
  readonly leaseMs?: number;
}

/** What a handler gets: the job, its validated payload and the household transaction it runs in. */
export interface JobContext<P> {
  readonly id: string;
  readonly householdId: string;
  /** The key the job was enqueued with (for an event's consumer: the event id). */
  readonly key: string;
  readonly payload: P;
  /** 1 for the first run, up to MAX_ATTEMPTS. */
  readonly attempt: number;
  /** Aborted when the worker stops: a handler that gives up returns the job to the queue without using an attempt. */
  readonly signal: AbortSignal;
}

export interface JobHandler<S extends z.ZodType = z.ZodType> {
  readonly job: JobDefinition<S>;
  /** Runs inside the module's household transaction; the job is marked done in the same transaction. */
  readonly run: (job: JobContext<z.infer<S>>, q: HouseholdQueryRunner) => Promise<void>;
}

/** FR 4: a job runs at most 8 times; after the 8th failure it goes to the dead-letter queue. */
export const MAX_ATTEMPTS = 8;
export const RETRY_BASE_MS = 10_000;
export const RETRY_MAX_MS = 60 * 60 * 1000;
export const DEFAULT_LEASE_MS = 5 * 60 * 1000;
export const DEDUPE_KEY_MAX = 200;

const JOB_NAME_RE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

export function defineJob<S extends z.ZodType>(definition: JobDefinition<S>): JobDefinition<S> {
  if (!JOB_NAME_RE.test(definition.name) || definition.name.length > 128)
    throw new Error(`Job name «${definition.name}» must be <module>.<job> in kebab-case`);
  if (
    definition.leaseMs !== undefined &&
    !(Number.isInteger(definition.leaseMs) && definition.leaseMs >= 1000)
  )
    throw new Error(`Job ${definition.name}: leaseMs must be an integer of at least 1000`);
  return definition;
}

export function defineJobHandler<S extends z.ZodType>(handler: JobHandler<S>): JobHandler {
  return handler as unknown as JobHandler;
}

/**
 * FR 4: exponential delay before the next attempt — 10 s after the first failure, doubling each time, at most
 * one hour (10 s, 20 s, 40 s … 640 s before the 8th attempt).
 */
export function retryDelayMs(failedAttempt: number): number {
  const exponent = Math.max(0, Math.min(failedAttempt - 1, 30));
  return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS);
}
