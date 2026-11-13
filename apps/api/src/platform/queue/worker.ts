import { randomUUID } from "node:crypto";
import type { EventRef } from "../events/define.ts";
import { runJob } from "../telemetry/jobs.ts";
import { logEvent } from "../telemetry/signals.ts";
import {
  DEFAULT_LEASE_MS,
  MAX_ATTEMPTS,
  retryDelayMs,
  type JobDefinition,
  type JobHandler,
} from "./define.ts";
import { LeaseLostError, type ClaimedJob, type JobStore } from "./store.ts";

/**
 * The worker role's loop (ARC-04, ARC-02 FR 1–2). The worker keeps no state of its own between jobs: every job,
 * event, attempt and lease is in the database, so any worker instance can be stopped, killed or added. Each pass:
 * for every module queue and every space, (1) hand the module's new events to the job queues of their consumers
 * and mark them dispatched — a crash in between hands them over again, and the consumer's job key (the event id)
 * keeps that a single job; (2) take due jobs up to the free capacity, heavy jobs only up to the one shared limit
 * across all spaces and modules (FR 5), and run each in its module's household transaction.
 */
export interface WorkerQueue {
  readonly store: JobStore;
  readonly handlers: readonly JobHandler[];
}

/** A module's consumer of an event: each event becomes one job of `job` in the consumer's queue. */
export interface EventSubscription {
  readonly event: EventRef;
  readonly consumer: string;
  readonly job: JobDefinition;
}

export interface WorkerOptions {
  readonly queues: readonly WorkerQueue[];
  readonly subscriptions?: readonly EventSubscription[];
  /** The spaces whose queues the worker serves (the household module's list in main.ts). */
  readonly households: () => Promise<readonly string[]>;
  /** The module's kill switch (CICD-06, ADR-0004): no job of a killed module is taken. */
  readonly moduleAvailable?: (module: string) => Promise<boolean>;
  /** Jobs at a time in this worker (default 4). */
  readonly concurrency?: number;
  /** Heavy jobs at a time in this worker, across all spaces (default 1; FR 5). */
  readonly heavyLimit?: number;
  /** Pause between passes when there was nothing to do (default 1 s). */
  readonly pollMs?: number;
  /** Delay before the next attempt (default `retryDelayMs`; tests pass 0). */
  readonly retryDelayMs?: (failedAttempt: number) => number;
  /** Events taken from one outbox in one pass (default 100). */
  readonly dispatchBatch?: number;
}

export interface Worker {
  /** This instance's id in the leases of the jobs it holds. */
  readonly owner: string;
  /** One pass; resolves once the jobs it took have started. Returns how many events and jobs it handled. */
  tick(): Promise<number>;
  /** Resolves when every job this worker has started has ended. */
  idle(): Promise<void>;
  /** Starts the timer loop. */
  start(): void;
  /** No more passes; running jobs are told to stop and, if they give up, go back to the queue unchanged. */
  stop(): Promise<void>;
  /** How many jobs (and heavy jobs) run now. */
  readonly running: { readonly all: number; readonly heavy: number };
}

export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_HEAVY_LIMIT = 1;
export const DEFAULT_POLL_MS = 1_000;

function errorClass(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name || error.name : typeof error;
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "Error";
}

export function createWorker(options: WorkerOptions): Worker {
  const owner = randomUUID();
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const heavyLimit = options.heavyLimit ?? DEFAULT_HEAVY_LIMIT;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const delay = options.retryDelayMs ?? retryDelayMs;
  const batch = options.dispatchBatch ?? 100;
  const subscriptions = options.subscriptions ?? [];
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be at least 1");
  if (!Number.isInteger(heavyLimit) || heavyLimit < 1 || heavyLimit > concurrency)
    throw new Error("heavyLimit must be between 1 and concurrency");

  const byModule = new Map<string, { store: JobStore; handlers: Map<string, JobHandler> }>();
  for (const queue of options.queues) {
    if (byModule.has(queue.store.module)) throw new Error(`Queue of ${queue.store.module} is given twice`);
    const handlers = new Map<string, JobHandler>();
    for (const handler of queue.handlers) {
      if (!handler.job.name.startsWith(`${queue.store.module}.`))
        throw new Error(`Module ${queue.store.module} may run only jobs named «${queue.store.module}.…»`);
      handlers.set(handler.job.name, handler);
    }
    byModule.set(queue.store.module, { store: queue.store, handlers });
  }
  for (const s of subscriptions) {
    const consumer = byModule.get(s.consumer);
    if (!consumer?.handlers.has(s.job.name))
      throw new Error(
        `${s.consumer} consumes ${s.event.name}@v${s.event.version} with ${s.job.name}, which it does not run`,
      );
  }

  const abort = new AbortController();
  const inFlight = new Set<Promise<void>>();
  let all = 0;
  let heavy = 0;
  let stopped = false;
  let passes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: Promise<number> | undefined;

  async function dispatch(store: JobStore, householdId: string): Promise<number> {
    const events = await store.pendingEvents(householdId, batch);
    if (events.length === 0) return 0;
    for (const event of events)
      for (const s of subscriptions) {
        if (s.event.name !== event.name || s.event.version !== event.version) continue;
        await byModule.get(s.consumer)!.store.enqueue(householdId, {
          name: s.job.name,
          key: event.id,
          payload: event.payload,
          heavy: s.job.heavy === true,
          traceparent: event.traceparent,
        });
      }
    await store.markDispatched(
      householdId,
      events.map((e) => e.id),
    );
    return events.length;
  }

  function execute(store: JobStore, handler: JobHandler, job: ClaimedJob): void {
    all += 1;
    if (job.heavy) heavy += 1;
    const run = (async () => {
      try {
        await runJob(
          job.name,
          job.traceparent ? { traceparent: job.traceparent } : undefined,
          () =>
            store.complete(job, owner, (q) =>
              handler.run(
                {
                  id: job.id,
                  householdId: job.householdId,
                  key: job.key,
                  payload: handler.job.schema.parse(job.payload),
                  attempt: job.attempt,
                  signal: abort.signal,
                },
                q,
              ),
            ),
          { failureSeverity: "warn" },
        );
      } catch (error) {
        if (error instanceof LeaseLostError) {
          logEvent("job.lease_lost", "warn", { "ws.module": store.module, "ws.job.name": job.name });
          return;
        }
        // A job the stopping worker interrupted goes back as it was (ARC-02 FR 5): no attempt is used.
        if (stopped) {
          await store.release(job, owner).catch(() => undefined);
          return;
        }
        const cls = errorClass(error);
        const outcome = await store
          .fail(job, owner, cls, delay(job.attempt), MAX_ATTEMPTS)
          .catch(() => "lost" as const);
        if (outcome === "dead") deadLettered(store.module, job.name, cls, job.attempt);
      }
    })().finally(() => {
      all -= 1;
      if (job.heavy) heavy -= 1;
      inFlight.delete(run);
    });
    inFlight.add(run);
  }

  async function claimAndRun(store: JobStore, handlers: Map<string, JobHandler>, householdId: string) {
    let started = 0;
    for (const isHeavy of [false, true]) {
      const free = isHeavy ? Math.min(heavyLimit - heavy, concurrency - all) : concurrency - all;
      const names = [...handlers.values()]
        .filter((h) => (h.job.heavy === true) === isHeavy)
        .map((h) => h.job.name);
      if (free <= 0 || names.length === 0) continue;
      const { claimed, exhausted } = await store.claim(householdId, {
        owner,
        names,
        heavy: isHeavy,
        limit: free,
        leaseMs: (name) => handlers.get(name)?.job.leaseMs ?? DEFAULT_LEASE_MS,
        maxAttempts: MAX_ATTEMPTS,
      });
      for (const job of exhausted) deadLettered(store.module, job.name, "LeaseExpired", job.attempts);
      for (const job of claimed) execute(store, handlers.get(job.name)!, job);
      started += claimed.length + exhausted.length;
    }
    return started;
  }

  async function pass(): Promise<number> {
    if (stopped || byModule.size === 0) return 0;
    const households = [...(await options.households())];
    if (households.length === 0) return 0;
    // A different space goes first on each pass, so one busy space cannot keep the others waiting.
    const start = passes++ % households.length;
    const ordered = [...households.slice(start), ...households.slice(0, start)];
    let handled = 0;
    for (const { store, handlers } of byModule.values()) {
      const available = options.moduleAvailable ? await options.moduleAvailable(store.module) : true;
      for (const householdId of ordered) {
        if (stopped) return handled;
        handled += await dispatch(store, householdId);
        if (available) handled += await claimAndRun(store, handlers, householdId);
      }
    }
    return handled;
  }

  const worker: Worker = {
    owner,
    tick() {
      current ??= pass().finally(() => {
        current = undefined;
      });
      return current;
    },
    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
    start() {
      const loop = (wait: number) => {
        if (stopped) return;
        timer = setTimeout(() => {
          void worker
            .tick()
            .catch((error: unknown) => {
              // The database may be away for a moment; the next pass tries again. The class only.
              logEvent("worker.pass_failed", "warn", { "error.type": errorClass(error) });
              return 0;
            })
            .then((handled) => loop(handled > 0 ? 0 : pollMs));
        }, wait);
      };
      loop(0);
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      abort.abort();
      await current?.catch(() => undefined);
      await worker.idle();
    },
    get running() {
      return { all, heavy };
    },
  };
  return worker;
}

/** FR 4, criterion «Задачі в черзі невдалих»: an «error» event for each job in the dead-letter queue, no space data. */
function deadLettered(module: string, name: string, cls: string, attempts: number): void {
  logEvent("job.dead_lettered", "error", {
    "ws.module": module,
    "ws.job.name": name,
    "error.type": cls,
    "ws.job.attempts": attempts,
  });
}
