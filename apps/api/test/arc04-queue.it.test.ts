import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { enableContextLogin, enableModuleLogin, migrate } from "../src/platform/db/migrate.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { moduleRoleName } from "../src/platform/modules/rules.ts";
import {
  DEFAULT_CONCURRENCY,
  MAX_ATTEMPTS,
  QUEUE_RETENTION_DAYS,
  QUEUE_TABLES_SQL,
  createWorker,
  enqueueJob,
  postgresJobStore,
  publishEvent,
  purgeQueues,
  type Worker,
  type WorkerOptions,
} from "../src/platform/queue/index.ts";
import { modulePoolSize } from "../src/wiring.ts";
import { exportedText, testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import {
  CONSUMER,
  PRODUCER,
  behaviour,
  flaky,
  importFile,
  light,
  queueSetup,
  recordThing,
  thingCreated,
  type Behaviour,
} from "./queue-fixture.ts";
import { migrateRealModules } from "./real-modules.ts";

/**
 * ARC-04@PoC on a real PostgreSQL (with ARC-02 FR 2 and NFR-05 FR 6): the job queue and the outbox in the modules'
 * own schemas. Two fixture modules ship the platform's queue migration verbatim: `queue-producer` publishes «thing
 * created», `queue-consumer` records each event (and runs the test jobs) as rows of `effects`.
 */
const telemetry = testTelemetryForFile();
const apiDir = fileURLToPath(new URL("..", import.meta.url));
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

/**
 * Passes until a pass that began with no job running finds nothing to do. A pass that finds nothing while a job is
 * still running proves little: that job's end can free the heavy limit or the capacity for jobs still queued (#199).
 */
async function drain(w: Worker): Promise<void> {
  for (let i = 0; i < 200; i++) {
    await w.idle();
    const handled = await w.tick();
    await w.idle();
    if (handled === 0) return;
  }
  throw new Error("the queue did not drain");
}

/** Rows as the database owner (outside the household policy, for the test's view of every space). */
async function rows<R extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<R[]> {
  return (await owner.query<R>(sql, values)).rows;
}

async function createThing(space: string, fail = false): Promise<string> {
  return databases.for(PRODUCER).inHousehold(space, async (q) => {
    const { rows: r } = await q.query<{ id: string }>(
      "INSERT INTO things (household_id, name) VALUES ($1, 'synthetic thing') RETURNING id",
      [q.householdId],
    );
    await publishEvent(q, thingCreated, { thingId: r[0]!.id });
    if (fail) throw new Error("the change is rolled back");
    return r[0]!.id;
  });
}

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  await migrate(owner, { modules: [PRODUCER, CONSUMER], modulesDir: fixtures });
  await enableModuleLogin(owner, PRODUCER, password);
  await enableModuleLogin(owner, CONSUMER, password);
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

describe("ARC-04@PoC: the job queue and the outbox in PostgreSQL", () => {
  it("ARC-04@PoC FR 1: the queue and the outbox are tables in each module's own schema, under the household policy", async () => {
    for (const module of [PRODUCER, CONSUMER]) {
      const sql = readFileSync(`${fixtures}/${module}/adapters/db/migrations/0001_queue.sql`, "utf8");
      expect(sql.startsWith(QUEUE_TABLES_SQL)).toBe(true);
    }
    // The first real module with the queue (ARC-11): the platform's migration verbatim, then its own additions.
    const ledgerSql = readFileSync(
      `${apiDir}/src/modules/ledger/adapters/db/migrations/0004_outbox.sql`,
      "utf8",
    );
    expect(ledgerSql.startsWith(QUEUE_TABLES_SQL)).toBe(true);
    const tables = await rows<{ schema: string; table: string; rls: boolean; forced: boolean }>(
      `SELECT n.nspname AS schema, c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname IN ('jobs', 'outbox_events') AND c.relkind = 'r' ORDER BY 1, 2`,
    );
    expect(tables).toEqual(
      ["ledger", "queue_consumer", "queue_producer"].flatMap((schema) =>
        ["jobs", "outbox_events"].map((table) => ({ schema, table, rls: true, forced: true })),
      ),
    );
    // Another space sees none of a space's jobs.
    await databases.for(CONSUMER).inHousehold(spaceA, (q) => enqueueJob(q, light, "k", { note: "a" }));
    const seen = await databases
      .for(CONSUMER)
      .inHousehold(spaceB, async (q) => (await q.query("SELECT 1 FROM jobs")).rowCount);
    expect(seen).toBe(0);
  });

  it("ARC-04@PoC FR 2: an event commits with its change and reaches the consumer; a rolled-back change publishes nothing", async () => {
    const thing = await createThing(spaceA);
    await expect(createThing(spaceB, true)).rejects.toThrow("rolled back");
    expect(await rows("SELECT household_id FROM queue_producer.outbox_events")).toEqual([
      { household_id: spaceA },
    ]);
    await drain(worker());
    expect(await rows("SELECT household_id, note FROM queue_consumer.effects")).toEqual([
      { household_id: spaceA, note: thing },
    ]);
    expect(await rows("SELECT 1 FROM queue_producer.outbox_events WHERE dispatched_at IS NULL")).toEqual([]);
  });

  it("ARC-04@PoC FR 3, NFR-05@PoC FR 6: the same job twice is one job; an event handed over twice is one job; a failed run leaves nothing and the retry gives the same result", async () => {
    const first = await databases
      .for(CONSUMER)
      .inHousehold(spaceA, (q) => enqueueJob(q, flaky, "same", { note: "x" }));
    const second = await databases
      .for(CONSUMER)
      .inHousehold(spaceA, (q) => enqueueJob(q, flaky, "same", { note: "x" }));
    expect([first, second]).toEqual([true, false]);
    // Each failed run writes its effect before failing: the rollback removes it.
    b.flakyFailures = 2;
    await drain(worker());
    expect(await rows("SELECT job_key, note FROM queue_consumer.effects")).toEqual([
      { job_key: "same", note: "x" },
    ]);
    expect(await rows("SELECT state, attempts FROM queue_consumer.jobs")).toEqual([
      { state: "done", attempts: 3 },
    ]);

    // The worker died between handing an event over and marking it dispatched: the next pass hands it over again.
    await owner.query("DELETE FROM queue_consumer.effects");
    await createThing(spaceB);
    await drain(worker());
    await owner.query("UPDATE queue_producer.outbox_events SET dispatched_at = NULL");
    await drain(worker());
    expect(
      await rows("SELECT count(*)::int AS n FROM queue_consumer.jobs WHERE name = $1", [recordThing.name]),
    ).toEqual([{ n: 1 }]);
    expect(await rows("SELECT count(*)::int AS n FROM queue_consumer.effects")).toEqual([{ n: 1 }]);
  });

  it("ARC-04@PoC FR 4, criterion «Задачі в черзі невдалих»: 8 attempts with growing delays, then the dead-letter queue and an «error» event without the space's data", async () => {
    await databases.for(CONSUMER).inHousehold(spaceB, (q) => enqueueJob(q, flaky, "doomed", { note: "x" }));
    b.flakyFailures = 100;
    // With the real delays: the first failure puts the job back about 10 s ahead.
    const real = createWorker({ ...queueSetup(databases, b), households: async () => [spaceA, spaceB] });
    workers.push(real);
    await real.tick();
    await real.idle();
    const [row] = await rows<{ ahead: number }>(
      "SELECT extract(epoch FROM run_after - now())::float8 AS ahead FROM queue_consumer.jobs",
    );
    expect(row!.ahead).toBeGreaterThan(8);
    expect(row!.ahead).toBeLessThanOrEqual(10);
    await owner.query("UPDATE queue_consumer.jobs SET run_after = now()");
    await drain(worker());
    expect(await rows("SELECT state, attempts, last_error FROM queue_consumer.jobs")).toEqual([
      { state: "dead", attempts: MAX_ATTEMPTS, last_error: "FlakyError" },
    ]);
    expect(b.flakyFailures).toBe(100 - MAX_ATTEMPTS);
    const dead = telemetry.memory.logRecords().filter((r) => r.body === "job.dead_lettered");
    expect(dead).toHaveLength(1);
    expect(dead[0]!.severityText).toBe("ERROR");
    expect(dead[0]!.attributes).toEqual({
      "ws.module": CONSUMER,
      "ws.job.name": flaky.name,
      "error.type": "FlakyError",
      "ws.job.attempts": MAX_ATTEMPTS,
    });
    // The retried attempts are warnings; nothing exported names the space or the job.
    expect(
      telemetry.memory.logRecords().filter((r) => r.body === "job.failed" && r.severityText !== "WARN"),
    ).toEqual([]);
    const text = await exportedText(telemetry);
    expect(text).not.toContain(spaceB);
    expect(text).not.toContain("doomed");
  });

  it("ARC-04@PoC FR 5: heavy jobs of all spaces share one limit; light jobs run beside them", async () => {
    let open!: () => void;
    b.hold = new Promise<void>((resolve) => (open = resolve));
    for (const space of [spaceA, spaceB])
      await databases.for(CONSUMER).inHousehold(space, async (q) => {
        for (const n of [1, 2]) await enqueueJob(q, importFile, `import-${n}`, { note: "i" });
        await enqueueJob(q, light, "light", { note: "l" });
      });
    const w = worker({ heavyLimit: 1, concurrency: 4 });
    await w.tick();
    await w.tick();
    expect(w.running).toEqual({ all: 3, heavy: 1 });
    open();
    await drain(w);
    expect(b.running.maxHeavy).toBe(1);
    expect(await rows("SELECT count(*)::int AS n FROM queue_consumer.jobs WHERE state = 'done'")).toEqual([
      { n: 6 },
    ]);
  });

  it("the kill switch of a module (CICD-06): its jobs are not taken while it is off", async () => {
    await databases.for(CONSUMER).inHousehold(spaceA, (q) => enqueueJob(q, light, "k", { note: "l" }));
    await drain(worker({ moduleAvailable: async (m) => m !== CONSUMER }));
    expect(await rows("SELECT state FROM queue_consumer.jobs")).toEqual([{ state: "queued" }]);
  });
});

describe("ARC-02@PoC FR 2 and the forced stop: workers keep no state", () => {
  it("ARC-02@PoC FR 2: two workers share the queue; the one stopped returns its job without using an attempt and the other finishes it", async () => {
    await createThing(spaceA);
    b.block = "until-abort";
    const first = worker();
    await first.tick();
    await first.tick();
    await new Promise((r) => setTimeout(r, 100));
    expect(first.running.all).toBe(1);
    await first.stop();
    expect(await rows("SELECT state, attempts FROM queue_consumer.jobs")).toEqual([
      { state: "queued", attempts: 0 },
    ]);
    expect(await rows("SELECT 1 FROM queue_consumer.effects")).toEqual([]);
    b.block = "no";
    await drain(worker());
    expect(await rows("SELECT state, attempts FROM queue_consumer.jobs")).toEqual([
      { state: "done", attempts: 1 },
    ]);
    expect(await rows("SELECT count(*)::int AS n FROM queue_consumer.effects")).toEqual([{ n: 1 }]);
  });

  it("ARC-04@PoC criterion «Втрачені події при збої процесу»: a worker killed mid-run (SIGKILL) loses no event; another delivers each one once", async () => {
    const things = new Set<string>();
    for (let i = 0; i < 10; i++) things.add(await createThing(i % 2 ? spaceA : spaceB));
    const child = spawn(process.execPath, ["test/fixtures/queue-worker-child.ts"], {
      cwd: apiDir,
      env: {
        PATH: process.env["PATH"] ?? "",
        WS_Q_DATABASE_URL: db.url,
        WS_Q_PASSWORD: password,
        WS_Q_HOUSEHOLDS: `${spaceA},${spaceB}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const exited = new Promise((resolve) => child.on("exit", resolve));
    for (let t = Date.now(); !out.includes("RUNNING");) {
      if (Date.now() - t > 20_000) throw new Error(`the worker did not start: ${out}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    child.kill("SIGKILL");
    await exited;
    // Its leases end after 1.5 s; then the jobs it held are taken again.
    await new Promise((r) => setTimeout(r, 1_700));
    await drain(worker());
    expect(await rows("SELECT 1 FROM queue_producer.outbox_events WHERE dispatched_at IS NULL")).toEqual([]);
    const effects = await rows<{ note: string }>("SELECT note FROM queue_consumer.effects");
    expect(effects).toHaveLength(10);
    expect(new Set(effects.map((e) => e.note))).toEqual(things);
    expect(await rows("SELECT DISTINCT state FROM queue_consumer.jobs")).toEqual([{ state: "done" }]);
    expect(await rows("SELECT count(*)::int AS n FROM queue_consumer.jobs WHERE attempts = 2")).not.toEqual([
      { n: 0 },
    ]);
  });
});

describe("ARC-04 follow-ups of #174 with the first real user of the queue (ARC-11)", () => {
  it("the worker's pool size of main.ts: with DEFAULT_CONCURRENCY jobs of one module running, the next pass still dispatches and claims", async () => {
    const pooled = new ModuleDatabases({
      connectionFor: (module) => ({ connectionString: urlAs(db.url, moduleRoleName(module), password) }),
      context: { connectionString: urlAs(db.url, CONTEXT_ROLE, password) },
      poolSize: modulePoolSize("worker")!,
    });
    let open!: () => void;
    b.hold = new Promise<void>((resolve) => (open = resolve));
    const w = worker(
      { concurrency: DEFAULT_CONCURRENCY, households: async () => [spaceA] },
      queueSetup(pooled, b),
    );
    try {
      await pooled.for(CONSUMER).inHousehold(spaceA, async (q) => {
        for (let n = 0; n < DEFAULT_CONCURRENCY; n++) await enqueueJob(q, light, `light-${n}`, { note: "l" });
      });
      await w.tick();
      // Every job is inside its handler, each on its own connection of the consumer's pool.
      for (const t = Date.now(); b.running.all < DEFAULT_CONCURRENCY && Date.now() - t < 3_000;)
        await new Promise((r) => setTimeout(r, 20));
      expect(b.running.all).toBe(DEFAULT_CONCURRENCY);
      // The next pass reads the consumer's outbox and hands a new event to its queue: it needs one more connection.
      await createThing(spaceA);
      const outcome = await Promise.race([
        w.tick().then(() => "passed"),
        new Promise((r) => setTimeout(() => r("stalled"), 3_000)),
      ]);
      expect(outcome).toBe("passed");
      open();
      await drain(w);
      expect(await rows("SELECT count(*)::int AS n FROM queue_consumer.effects")).toEqual([
        { n: DEFAULT_CONCURRENCY + 1 },
      ]);
    } finally {
      open();
      await w.stop();
      await pooled.end();
    }
  });

  it("retention: dispatched events and finished jobs older than their period are deleted; nothing still to do, nothing younger, no other space", async () => {
    const event = (space: string, dispatchedDaysAgo: number | null) =>
      owner.query(
        `INSERT INTO queue_producer.outbox_events (household_id, event_name, event_version, payload, created_at, dispatched_at)
         VALUES ($1, $2, 1, '{}', now() - interval '100 days', now() - make_interval(days => $3))`,
        [space, thingCreated.name, dispatchedDaysAgo],
      );
    const job = (space: string, key: string, state: string, finishedDaysAgo: number | null) =>
      owner.query(
        `INSERT INTO queue_consumer.jobs (household_id, name, dedupe_key, payload, state, created_at, finished_at)
         VALUES ($1, $2, $3, '{}', $4, now() - interval '100 days', now() - make_interval(days => $5))`,
        [space, light.name, key, state, finishedDaysAgo],
      );
    const { dispatchedEvents, doneJobs, deadJobs } = QUEUE_RETENTION_DAYS;
    for (const space of [spaceA, spaceB]) {
      await event(space, dispatchedEvents + 1);
      await event(space, dispatchedEvents - 1);
      await event(space, null);
      await job(space, "done-old", "done", doneJobs + 1);
      await job(space, "done-young", "done", doneJobs - 1);
      await job(space, "dead-old", "dead", deadJobs + 1);
      await job(space, "dead-young", "dead", deadJobs - 1);
      await job(space, "queued", "queued", null);
      await job(space, "running", "running", null);
    }
    const deleted = await purgeQueues({
      stores: [postgresJobStore(databases.for(PRODUCER)), postgresJobStore(databases.for(CONSUMER))],
      households: async () => [spaceA],
      now: () => Date.now(),
    });
    expect(deleted).toEqual({ events: 1, jobs: 2 });
    expect(
      await rows(
        `SELECT household_id = $1 AS a, dispatched_at IS NULL AS pending FROM queue_producer.outbox_events
          ORDER BY 1, 2`,
        [spaceA],
      ),
    ).toEqual([
      { a: false, pending: false },
      { a: false, pending: false },
      { a: false, pending: true },
      { a: true, pending: false },
      { a: true, pending: true },
    ]);
    expect(
      (
        await rows<{ dedupe_key: string }>(
          "SELECT dedupe_key FROM queue_consumer.jobs WHERE household_id = $1 ORDER BY 1",
          [spaceA],
        )
      ).map((r) => r.dedupe_key),
    ).toEqual(["dead-young", "done-young", "queued", "running"]);
    expect(
      await rows("SELECT count(*)::int AS n FROM queue_consumer.jobs WHERE household_id = $1", [spaceB]),
    ).toEqual([{ n: 6 }]);
    // A second run deletes nothing more.
    expect(
      await purgeQueues({
        stores: [postgresJobStore(databases.for(PRODUCER)), postgresJobStore(databases.for(CONSUMER))],
        households: async () => [spaceA],
        now: () => Date.now(),
      }),
    ).toEqual({ events: 0, jobs: 0 });
  });
});
