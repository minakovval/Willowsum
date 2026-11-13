import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { enableContextLogin, enableModuleLogin, migrate } from "../src/platform/db/migrate.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { schemaProblems } from "../src/platform/db/schema-rules.ts";
import { moduleRoleName } from "../src/platform/modules/rules.ts";
import {
  LeaseLostError,
  MAX_ATTEMPTS,
  createWorker,
  defineJob,
  defineJobHandler,
  enqueueJob,
  postgresJobStore,
  publishEvent,
  type ClaimedJob,
  type Worker,
  type WorkerOptions,
} from "../src/platform/queue/index.ts";
import { redactAttributes } from "../src/platform/telemetry/redaction.ts";
import { exportedText, testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import {
  CONSUMER,
  PRODUCER,
  behaviour,
  light,
  queueSetup,
  thingCreated,
  type Behaviour,
} from "./queue-fixture.ts";
import { migrateRealModules } from "./real-modules.ts";

/**
 * Security properties of the ARC-04 queue (security review of #174, `pullrequestreview-5895772977`, its eight proposed
 * tests written anew): module roles only, the schema rules on the queue tables, no space reaching another space's
 * jobs or events, no existence oracle through job keys, the dead-letter route of an 8th attempt lost with its worker,
 * and nothing of a job's payload, key, space or error message in telemetry or `last_error`. Fixture modules
 * `queue-producer` and `queue-consumer` (the platform's queue migration verbatim) and the real `ledger` module.
 */
const telemetry = testTelemetryForFile();
const fixtures = fileURLToPath(new URL("./fixtures/db-modules", import.meta.url));
const password = randomBytes(12).toString("hex");

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;
let b: Behaviour;
const workers: Worker[] = [];
const spaceA = randomUUID();
const spaceB = randomUUID();

function worker(extra: Partial<WorkerOptions> = {}, setup = queueSetup(databases, b)): Worker {
  const w = createWorker({
    ...setup,
    households: async () => [spaceA, spaceB],
    retryDelayMs: () => 0,
    pollMs: 20,
    ...extra,
  });
  workers.push(w);
  return w;
}

async function drain(w: Worker): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const handled = await w.tick();
    await w.idle();
    if (handled === 0) return;
  }
  throw new Error("the queue did not drain");
}

async function rows<R extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<R[]> {
  return (await owner.query<R>(sql, values)).rows;
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? String(e),
  );

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  await migrate(owner, { modules: [PRODUCER, CONSUMER], modulesDir: fixtures });
  for (const module of [PRODUCER, CONSUMER, "ledger"]) await enableModuleLogin(owner, module, password);
  await enableContextLogin(owner, password);
  databases = new ModuleDatabases({
    connectionFor: (module) => ({ connectionString: urlAs(db.url, moduleRoleName(module), password) }),
    context: { connectionString: urlAs(db.url, CONTEXT_ROLE, password) },
    poolSize: 6,
  });
});

beforeEach(async () => {
  b = behaviour();
  await Promise.all(workers.splice(0).map((w) => w.stop()));
  for (const table of [
    "queue_producer.outbox_events",
    "queue_producer.things",
    "queue_consumer.jobs",
    "queue_consumer.effects",
  ])
    await owner.query(`DELETE FROM ${table}`);
});

afterAll(async () => {
  await Promise.all(workers.map((w) => w.stop()));
  await databases?.end();
  await owner?.end();
  await db?.drop();
});

describe("ARC-04 queue security (review of #174): roles and schema", () => {
  it("the worker's connections are module roles: each store logs in as its module's role, none is superuser or BYPASSRLS, and none reaches another module's queue", async () => {
    for (const module of [PRODUCER, CONSUMER, "ledger"]) {
      const who = await databases
        .for(module)
        .inHousehold(
          spaceA,
          async (q) => (await q.query("SELECT current_user AS c, session_user AS s")).rows[0],
        );
      expect(who).toEqual({ c: moduleRoleName(module), s: moduleRoleName(module) });
    }
    expect(
      await rows(`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ANY($1) ORDER BY 1`, [
        [PRODUCER, CONSUMER, "ledger"].map(moduleRoleName),
      ]),
    ).toEqual(
      [PRODUCER, CONSUMER, "ledger"]
        .map(moduleRoleName)
        .sort()
        .map((rolname) => ({ rolname, rolsuper: false, rolbypassrls: false })),
    );
    const reach = (module: string, sql: string) =>
      code(databases.for(module).inHousehold(spaceA, (q) => q.query(sql)));
    expect(await reach(PRODUCER, "SELECT 1 FROM queue_consumer.jobs")).toBe("42501");
    expect(await reach(PRODUCER, "SELECT 1 FROM queue_consumer.outbox_events")).toBe("42501");
    expect(await reach(CONSUMER, "SELECT 1 FROM queue_producer.outbox_events")).toBe("42501");
    expect(await reach(CONSUMER, "SELECT 1 FROM ledger.outbox_events")).toBe("42501");
    expect(await reach("ledger", "SELECT 1 FROM queue_consumer.jobs")).toBe("42501");
  });

  it("the queue tables pass the ARC-03 schema rules: the household policy with USING and WITH CHECK on each", async () => {
    expect(await schemaProblems(owner, [PRODUCER, CONSUMER, "ledger"])).toEqual([]);
    const policies = await rows<{ schema: string; table: string; using: boolean; check: boolean }>(
      `SELECT n.nspname AS schema, c.relname AS table, p.polqual IS NOT NULL AS using, p.polwithcheck IS NOT NULL AS check
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname IN ('jobs', 'outbox_events') AND n.nspname = ANY($1) ORDER BY 1, 2`,
      [["ledger", "queue_consumer", "queue_producer"]],
    );
    expect(policies).toEqual(
      ["ledger", "queue_consumer", "queue_producer"].flatMap((schema) =>
        ["jobs", "outbox_events"].map((table) => ({ schema, table, using: true, check: true })),
      ),
    );
  });
});

describe("ARC-04 queue security (review of #174): one space never reaches another space's queue", () => {
  it("a worker serving only space B neither claims nor runs space A's job, and a forged job of B cannot finish, fail or release it", async () => {
    await databases.for(CONSUMER).inHousehold(spaceA, (q) => enqueueJob(q, light, "a-job", { note: "a" }));
    await drain(worker({ households: async () => [spaceB] }));
    expect(await rows("SELECT state, attempts FROM queue_consumer.jobs")).toEqual([
      { state: "queued", attempts: 0 },
    ]);
    expect(await rows("SELECT 1 FROM queue_consumer.effects")).toEqual([]);

    // A's job is running under a lease; a forged job carries its id with B's household and the same lease owner.
    const lease = randomUUID();
    const [a] = await rows<{ id: string }>(
      `UPDATE queue_consumer.jobs SET state = 'running', attempts = 1, lease_owner = $1,
         lease_until = now() + interval '1 hour' RETURNING id`,
      [lease],
    );
    const forged: ClaimedJob = {
      id: a!.id,
      householdId: spaceB,
      name: light.name,
      key: "a-job",
      payload: { note: "a" },
      attempt: 1,
      heavy: false,
      traceparent: null,
    };
    const store = postgresJobStore(databases.for(CONSUMER));
    await expect(
      store.complete(forged, lease, (q) =>
        q.query("INSERT INTO effects (household_id, job_key, note) VALUES ($1, 'forged', 'x')", [
          q.householdId,
        ]),
      ),
    ).rejects.toBeInstanceOf(LeaseLostError);
    expect(await store.fail(forged, lease, "Error", 0, MAX_ATTEMPTS)).toBe("lost");
    await store.release(forged, lease);
    expect(
      (
        await store.claim(spaceB, {
          owner: randomUUID(),
          names: [light.name],
          heavy: false,
          limit: 10,
          leaseMs: () => 1_000,
          maxAttempts: MAX_ATTEMPTS,
        })
      ).claimed,
    ).toEqual([]);
    expect(await rows("SELECT state, attempts, lease_owner FROM queue_consumer.jobs")).toEqual([
      { state: "running", attempts: 1, lease_owner: lease },
    ]);
    expect(await rows("SELECT 1 FROM queue_consumer.effects")).toEqual([]);
  });

  it("space B does not see or mark space A's outbox events", async () => {
    const id = await databases
      .for(PRODUCER)
      .inHousehold(spaceA, (q) => publishEvent(q, thingCreated, { thingId: randomUUID() }));
    const store = postgresJobStore(databases.for(PRODUCER));
    expect(await store.pendingEvents(spaceB, 100)).toEqual([]);
    await store.markDispatched(spaceB, [id]);
    expect(await rows("SELECT dispatched_at FROM queue_producer.outbox_events")).toEqual([
      { dispatched_at: null },
    ]);
    expect((await store.pendingEvents(spaceA, 100)).map((e) => e.id)).toEqual([id]);
    // Retention of space B removes nothing of space A either.
    await owner.query("UPDATE queue_producer.outbox_events SET dispatched_at = now() - interval '400 days'");
    const far = new Date(Date.now() + 1000 * 24 * 3600 * 1000);
    expect(await store.purge(spaceB, { dispatchedBefore: far, doneBefore: far, deadBefore: far })).toEqual({
      events: 0,
      jobs: 0,
    });
    expect(await rows("SELECT count(*)::int AS n FROM queue_producer.outbox_events")).toEqual([{ n: 1 }]);
  });

  it("the same job key in another space is a new job, not an existence oracle", async () => {
    const enqueue = (space: string) =>
      databases.for(CONSUMER).inHousehold(space, (q) => enqueueJob(q, light, "same-key", { note: "x" }));
    expect(await enqueue(spaceA)).toBe(true);
    expect(await enqueue(spaceB)).toBe(true);
    expect(await enqueue(spaceB)).toBe(false);
    expect(
      await rows("SELECT household_id FROM queue_consumer.jobs WHERE dedupe_key = 'same-key' ORDER BY 1"),
    ).toEqual([spaceA, spaceB].sort().map((household_id) => ({ household_id })));
  });
});

describe("ARC-04 queue security (review of #174): attempts and what leaves the process", () => {
  it("ARC-04@PoC FR 4, criterion «Задачі в черзі невдалих»: a job whose 8th attempt died with its worker goes to the dead-letter queue with an «error» event, without a 9th run", async () => {
    await databases.for(CONSUMER).inHousehold(spaceA, (q) => enqueueJob(q, light, "lost", { note: "x" }));
    await owner.query(
      `UPDATE queue_consumer.jobs SET state = 'running', attempts = $1, lease_owner = gen_random_uuid(),
         lease_until = now() - interval '1 second'`,
      [MAX_ATTEMPTS],
    );
    const runs: string[] = [];
    b.onRun = (name) => runs.push(name);
    await drain(worker());
    expect(await rows("SELECT state, attempts, last_error FROM queue_consumer.jobs")).toEqual([
      { state: "dead", attempts: MAX_ATTEMPTS, last_error: "LeaseExpired" },
    ]);
    expect(runs).toEqual([]);
    const dead = telemetry.memory.logRecords().filter((r) => r.body === "job.dead_lettered");
    expect(dead).toHaveLength(1);
    expect(dead[0]!.severityText).toBe("ERROR");
    expect(dead[0]!.attributes).toEqual({
      "ws.module": CONSUMER,
      "ws.job.name": light.name,
      "error.type": "LeaseExpired",
      "ws.job.attempts": MAX_ATTEMPTS,
    });
    expect(await rows("SELECT count(*)::int AS n FROM queue_consumer.effects")).toEqual([{ n: 0 }]);
  });

  it("neither the payload, the key, the space nor an error message reaches telemetry or last_error", async () => {
    const leaky = defineJob({ name: "queue-consumer.leaky", schema: z.object({ note: z.string() }) });
    const setup = {
      queues: [
        {
          store: postgresJobStore(databases.for(CONSUMER)),
          handlers: [
            defineJobHandler({
              job: leaky,
              run: async (job) => {
                // An error whose message carries the payload and the key.
                throw new Error(`failed on ${job.payload.note} with ${job.key}`);
              },
            }),
          ],
        },
      ],
      subscriptions: [],
    };
    await databases
      .for(CONSUMER)
      .inHousehold(spaceA, (q) => enqueueJob(q, leaky, "secret-key-6f1d", { note: "secret-note-93ab" }));
    // A stored payload that fails the job's schema: the handler never runs, the ZodError is recorded by class.
    await owner.query(
      `INSERT INTO queue_consumer.jobs (household_id, name, dedupe_key, payload) VALUES ($1, $2, 'bad-key-4c2e',
         '{"wrong": "secret-payload-77d0"}')`,
      [spaceB, leaky.name],
    );
    await drain(worker({}, setup));
    const finished = await rows<{ dedupe_key: string; state: string; last_error: string }>(
      "SELECT dedupe_key, state, last_error FROM queue_consumer.jobs ORDER BY 1",
    );
    expect(finished.map((r) => [r.dedupe_key, r.state])).toEqual([
      ["bad-key-4c2e", "dead"],
      ["secret-key-6f1d", "dead"],
    ]);
    expect(finished[1]!.last_error).toBe("Error");
    expect(finished[0]!.last_error).toMatch(/^[A-Za-z][A-Za-z0-9]{0,63}$/);
    expect(finished[0]!.last_error).toMatch(/ZodError/);
    const text = await exportedText(telemetry);
    for (const secret of [
      "secret-note-93ab",
      "secret-key-6f1d",
      "bad-key-4c2e",
      "secret-payload-77d0",
      "failed on",
      spaceA,
      spaceB,
    ])
      expect(text, secret).not.toContain(secret);
  });

  it("ws.job.attempts carries only a small integer: anything else is dropped and counted as redacted", () => {
    expect(redactAttributes({ "ws.job.attempts": 8 })).toEqual({ "ws.job.attempts": 8 });
    for (const value of ["8 secret-note", 101, 0, 1.5, 1_000_000])
      expect(redactAttributes({ "ws.job.attempts": value }), String(value)).toEqual({
        "ws.telemetry.redacted": 1,
      });
  });
});
