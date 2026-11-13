import type { JobStore } from "./store.ts";

/**
 * Retention of the queue's own rows (ARC-04; ADR-0014 «Наслідки»; security review of #174, item 1). A dispatched event
 * and a finished job are working copies: the change they report stays in the module's own tables, so after the
 * period below they are deleted. Rows still to do (events not dispatched, jobs queued or running) are never deleted.
 * Dead-lettered jobs stay longer, so their failure can still be looked into. The periods are a lead decision
 * (docs/decisions/log/2026-11-13-queue-retention.md), not NFR-12 categories of a space's data.
 */
export const QUEUE_RETENTION_DAYS = { dispatchedEvents: 7, doneJobs: 7, deadJobs: 30 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface QueueRetentionDeps {
  readonly stores: readonly Pick<JobStore, "module" | "purge">[];
  readonly households: () => Promise<readonly string[]>;
  /** The time the periods are counted back from (the scheduler passes the wall clock, tests their own). */
  readonly now: () => number;
}

/** One run of the daily retention cleanup over every queue and every space. Idempotent. */
export async function purgeQueues(deps: QueueRetentionDeps): Promise<{ events: number; jobs: number }> {
  // One reading of the clock for the whole run (#92: never re-read the time to pick a window).
  const now = deps.now();
  const cutoffs = {
    dispatchedBefore: new Date(now - QUEUE_RETENTION_DAYS.dispatchedEvents * DAY_MS),
    doneBefore: new Date(now - QUEUE_RETENTION_DAYS.doneJobs * DAY_MS),
    deadBefore: new Date(now - QUEUE_RETENTION_DAYS.deadJobs * DAY_MS),
  };
  const households = await deps.households();
  const total = { events: 0, jobs: 0 };
  for (const store of deps.stores)
    for (const householdId of households) {
      const deleted = await store.purge(householdId, cutoffs);
      total.events += deleted.events;
      total.jobs += deleted.jobs;
    }
  return total;
}
