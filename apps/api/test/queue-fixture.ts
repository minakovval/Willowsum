import { z } from "zod";
import type { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { defineEvent } from "../src/platform/events/define.ts";
import {
  defineJob,
  defineJobHandler,
  postgresJobStore,
  type EventSubscription,
  type Worker,
  type WorkerQueue,
} from "../src/platform/queue/index.ts";

/**
 * ARC-04 test modules (fixtures `queue-producer` and `queue-consumer`, both with the platform's queue migration):
 * the producer publishes «thing created», the consumer records each one as an effect. Shared by the integration
 * test and the worker process it kills (fixtures/queue-worker-child.ts).
 */
export const PRODUCER = "queue-producer";
export const CONSUMER = "queue-consumer";

export const thingCreated = defineEvent({
  name: "queue-producer.thing-created",
  version: 1,
  schema: z.object({ thingId: z.uuid() }),
});

export const recordThing = defineJob({
  name: "queue-consumer.record-thing",
  schema: z.object({ thingId: z.uuid() }),
  leaseMs: 1_500,
});
export const flaky = defineJob({ name: "queue-consumer.flaky", schema: z.object({ note: z.string() }) });
export const importFile = defineJob({
  name: "queue-consumer.import-file",
  schema: z.object({ note: z.string() }),
  heavy: true,
});
export const light = defineJob({ name: "queue-consumer.light", schema: z.object({ note: z.string() }) });

/** What the handlers do; a test changes it between runs. */
export interface Behaviour {
  /** How many more runs of `flaky` fail (after writing their effect, which must roll back). */
  flakyFailures: number;
  /** Block `record-thing` (after writing its effect) until the signal aborts — or forever. */
  block: "no" | "until-abort" | "forever";
  /** Hold `import-file` and `light` runs until this resolves. */
  hold: Promise<void>;
  running: { all: number; heavy: number; maxHeavy: number };
  onRun: (name: string, key: string) => void;
}

export function behaviour(): Behaviour {
  return {
    flakyFailures: 0,
    block: "no",
    hold: Promise.resolve(),
    running: { all: 0, heavy: 0, maxHeavy: 0 },
    onRun: () => undefined,
  };
}

export class FlakyError extends Error {}

/**
 * Passes until a pass that began with no job running finds nothing to do. A pass that finds nothing while a job is
 * still running proves little: that job's end can free the heavy limit or the capacity for jobs still queued, so
 * stopping there leaves them queued (#199, #222). The one helper of every queue test: a copy that lacks the first
 * `idle()` fails only when a released job is slower to finish than the pass is to reach its claim.
 */
export async function drain(w: Pick<Worker, "tick" | "idle">): Promise<void> {
  for (let i = 0; i < 200; i++) {
    await w.idle();
    const handled = await w.tick();
    await w.idle();
    if (handled === 0) return;
  }
  throw new Error("the queue did not drain");
}

export function queueSetup(
  databases: Pick<ModuleDatabases, "for">,
  b: Behaviour,
): { queues: WorkerQueue[]; subscriptions: EventSubscription[] } {
  const effect = async (
    q: { query: (t: string, v?: readonly unknown[]) => Promise<unknown> },
    h: string,
    key: string,
    note: string,
  ) => q.query("INSERT INTO effects (household_id, job_key, note) VALUES ($1, $2, $3)", [h, key, note]);
  const held =
    (heavy: boolean) =>
    async (
      job: { householdId: string; key: string; payload: { note: string } },
      q: Parameters<typeof effect>[0],
    ) => {
      b.running.all += 1;
      if (heavy) b.running.maxHeavy = Math.max(b.running.maxHeavy, (b.running.heavy += 1));
      b.onRun(heavy ? importFile.name : light.name, job.key);
      try {
        await b.hold;
        await effect(q, job.householdId, job.key, job.payload.note);
      } finally {
        b.running.all -= 1;
        if (heavy) b.running.heavy -= 1;
      }
    };
  return {
    queues: [
      { store: postgresJobStore(databases.for(PRODUCER)), handlers: [] },
      {
        store: postgresJobStore(databases.for(CONSUMER)),
        handlers: [
          defineJobHandler({
            job: recordThing,
            run: async (job, q) => {
              await effect(q, job.householdId, job.key, job.payload.thingId);
              b.onRun(recordThing.name, job.key);
              if (b.block === "forever") await new Promise(() => undefined);
              if (b.block === "until-abort")
                await new Promise<void>((_, reject) => {
                  if (job.signal.aborted) reject(new Error("stopped"));
                  job.signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
                });
            },
          }),
          defineJobHandler({
            job: flaky,
            run: async (job, q) => {
              await effect(q, job.householdId, job.key, job.payload.note);
              b.onRun(flaky.name, job.key);
              if (b.flakyFailures > 0) {
                b.flakyFailures -= 1;
                throw new FlakyError();
              }
            },
          }),
          defineJobHandler({ job: importFile, run: held(true) }),
          defineJobHandler({ job: light, run: held(false) }),
        ],
      },
    ],
    subscriptions: [{ event: thingCreated, consumer: CONSUMER, job: recordThing }],
  };
}
