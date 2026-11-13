import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { HouseholdQueryRunner } from "../db/module-db.ts";
import {
  MAX_ATTEMPTS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  createWorker,
  defineJob,
  defineJobHandler,
  retryDelayMs,
  type ClaimedJob,
  type JobStore,
} from "./index.ts";

/**
 * A job store kept in memory: the worker and the module's handler run unchanged over a store that is not
 * PostgreSQL (ARC-04 FR 1 — a managed queue can replace the PostgreSQL one without changes in the modules).
 */
function memoryStore(
  module: string,
): JobStore & { jobs: Map<string, ClaimedJob & { state: string; attempts: number }> } {
  const jobs = new Map<string, ClaimedJob & { state: string; attempts: number }>();
  const q = {
    householdId: "",
    query: async () => ({ rows: [], rowCount: 0 }),
  } as unknown as HouseholdQueryRunner;
  return {
    module,
    jobs,
    claim: async (householdId, r) => {
      const claimed: ClaimedJob[] = [];
      for (const job of jobs.values())
        if (
          job.householdId === householdId &&
          job.state === "queued" &&
          job.heavy === r.heavy &&
          claimed.length < r.limit
        ) {
          job.state = "running";
          job.attempts += 1;
          claimed.push({ ...job, attempt: job.attempts });
        }
      return { claimed, exhausted: [] };
    },
    complete: async (job, _owner, work) => {
      await work({ ...q, householdId: job.householdId });
      jobs.get(job.id)!.state = "done";
    },
    fail: async (job, _owner, _cls, _delay, max) => {
      const stored = jobs.get(job.id)!;
      stored.state = stored.attempts >= max ? "dead" : "queued";
      return stored.state === "dead" ? "dead" : "retry";
    },
    release: async (job) => {
      const stored = jobs.get(job.id)!;
      stored.state = "queued";
      stored.attempts -= 1;
    },
    enqueue: async (householdId, job) => {
      const id = `${householdId}/${job.name}/${job.key}`;
      if (jobs.has(id)) return false;
      jobs.set(id, {
        id,
        householdId,
        name: job.name,
        key: job.key,
        payload: job.payload,
        heavy: job.heavy,
        traceparent: job.traceparent,
        attempt: 0,
        state: "queued",
        attempts: 0,
      });
      return true;
    },
    pendingEvents: async () => [],
    markDispatched: async () => undefined,
    purge: async () => ({ events: 0, jobs: 0 }),
  };
}

const sum = defineJob({ name: "reports.sum", schema: z.object({ n: z.number().int() }) });
const big = defineJob({ name: "reports.big", schema: z.object({ n: z.number().int() }), heavy: true });

describe("ARC-04@PoC: retries and the job interface", () => {
  it("ARC-04@PoC FR 4: up to 8 attempts with an exponential delay — 10 s, doubling, at most one hour", () => {
    expect(MAX_ATTEMPTS).toBe(8);
    expect([1, 2, 3, 4, 5, 6, 7].map(retryDelayMs)).toEqual(
      [10, 20, 40, 80, 160, 320, 640].map((s) => s * 1000),
    );
    expect(RETRY_BASE_MS).toBe(10_000);
    expect(retryDelayMs(100)).toBe(RETRY_MAX_MS);
  });

  it("job names are <module>.<job>; a module runs only its own jobs; a consumer must run the job it subscribes with", () => {
    expect(() => defineJob({ name: "Reports sum", schema: z.object({}) })).toThrow("<module>.<job>");
    expect(() => defineJob({ name: "reports.sum", schema: z.object({}), leaseMs: 10 })).toThrow("leaseMs");
    const handler = defineJobHandler({ job: sum, run: async () => undefined });
    expect(() =>
      createWorker({
        queues: [{ store: memoryStore("budget"), handlers: [handler] }],
        households: async () => [],
      }),
    ).toThrow("only jobs named «budget.…»");
    expect(() =>
      createWorker({
        queues: [{ store: memoryStore("reports"), handlers: [] }],
        subscriptions: [{ event: { name: "ledger.posted", version: 1 }, consumer: "reports", job: sum }],
        households: async () => [],
      }),
    ).toThrow("which it does not run");
    expect(() => createWorker({ queues: [], households: async () => [], heavyLimit: 0 })).toThrow(
      "heavyLimit",
    );
  });

  it("ARC-04@PoC FR 1: the worker and an unchanged module handler run over a store that is not PostgreSQL", async () => {
    const store = memoryStore("reports");
    const seen: number[] = [];
    const handler = defineJobHandler({
      job: sum,
      run: async (job) => {
        seen.push(job.payload.n);
      },
    });
    await store.enqueue("h1", {
      name: sum.name,
      key: "a",
      payload: { n: 2 },
      heavy: false,
      traceparent: null,
    });
    const worker = createWorker({ queues: [{ store, handlers: [handler] }], households: async () => ["h1"] });
    await worker.tick();
    await worker.idle();
    expect(seen).toEqual([2]);
    expect(store.jobs.get("h1/reports.sum/a")!.state).toBe("done");
  });

  it("ARC-04@PoC FR 5: one shared limit of heavy jobs across spaces; the rest of the capacity serves light jobs", async () => {
    const store = memoryStore("reports");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const handlers = [sum, big].map((job) => defineJobHandler({ job, run: () => gate }));
    for (const h of ["h1", "h2"])
      for (const [job, key] of [
        [big, "1"],
        [big, "2"],
        [sum, "1"],
      ] as const)
        await store.enqueue(h, {
          name: job.name,
          key,
          payload: { n: 1 },
          heavy: job.heavy === true,
          traceparent: null,
        });
    const worker = createWorker({
      queues: [{ store, handlers }],
      households: async () => ["h1", "h2"],
      heavyLimit: 1,
      concurrency: 3,
    });
    await worker.tick();
    expect(worker.running).toEqual({ all: 3, heavy: 1 });
    release();
    await worker.idle();
    for (let i = 0; i < 4; i++) {
      await worker.tick();
      expect(worker.running.heavy).toBeLessThanOrEqual(1);
      await worker.idle();
    }
    expect([...store.jobs.values()].every((j) => j.state === "done")).toBe(true);
  });
});
