// Security review of PR #266 (ARC-04 d). Harness copied from arc04-liabilities-hand-off.it.test.ts and nfr12-erasure.it.test.ts.
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { localErasureLog } from "../src/platform/adapters/erasure-log/index.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { exportedText, testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { personWithSpace, spaceRows, withTestErasureDatabases } from "./erasure-helpers.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createDataErasure } from "../src/modules/data-erasure/index.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createLedger, type Ledger } from "../src/modules/ledger/index.ts";
import {
  createLiabilities,
  createLiabilitiesErasure,
  type Liabilities,
} from "../src/modules/liabilities/index.ts";
import { createFxReporting } from "../src/modules/fx-rates/index.ts";
import { createAccountsServices } from "../src/modules/accounts/index.ts";

/**
 * Security probes of ARC-04 d (PR #266): the audit entry of `liabilities.register` / `changeKind` is never lost and
 * never doubled (a process that ends after the commit, the route and the worker at once, retries, dead → recovery →
 * retention), the liabilities queue keeps to its space (row policy, worker, recovery, erasure, a forged job), a job,
 * `last_error` and telemetry hold no personal data or error text, amounts survive the job as decimal strings, a kind
 * change under the account's row lock neither blocks nor loses its entry, and the owner's erasure (its own roles)
 * takes the queue rows. Real API, real PostgreSQL, synthetic data.
 */
const WEB = "http://localhost:5173";
const TODAY = "2026-10-17";
const NOW = Date.parse(`${TODAY}T10:00:00Z`);
const telemetry = testTelemetryForFile();

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let ledger: Ledger;
let liabilities: Liabilities;
let app: ReturnType<typeof buildServer>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

function call(space: Space, method: "POST" | "PATCH" | "GET", url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const loanTerms = { kind: "loan" as const, currency: "EUR", annualRate: "6", monthlyPayment: "650.00" };
const card = {
  kind: "credit-card",
  name: "Картка Синтетичної Олени",
  balance: { amount: "300.00", currency: "EUR" },
  balanceDate: "2026-10-01",
  annualRate: "30",
  creditLimit: "2000.00",
};

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}
const liabilityAudit = (householdId: string, action: "create" | "update") =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = 'liabilities.liability' AND action = $2",
    householdId,
    action,
  );
const jobs = async (householdId: string) =>
  (
    await db.owner.query<{ state: string; attempts: number; last_error: string | null; dedupe_key: string }>(
      `SELECT state, attempts, last_error, dedupe_key FROM liabilities.jobs WHERE household_id = $1 ORDER BY created_at, id`,
      [householdId],
    )
  ).rows;
const register = (space: Space, terms: Record<string, unknown> = loanTerms, accountId = randomUUID()) =>
  liabilities.register(space.householdId, {
    actorAccountId: space.accountId,
    accountId,
    terms: terms as typeof loanTerms,
  });

function worker(householdIds: readonly string[]) {
  return createWorker({ ...workerQueues(db.databases), households: async () => [...householdIds] });
}
async function runWorker(...householdIds: string[]): Promise<void> {
  const w = worker(householdIds);
  try {
    await w.tick();
    await w.idle();
  } finally {
    await w.stop();
  }
}

/** Fails every `audit.record` of a liability with an error whose text carries `secret`, until restored. */
function failLiabilityAudit(secret = "injected"): void {
  const original = audit.record.bind(audit);
  vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
    if (entry.entity.type === "liabilities.liability") throw new Error(secret);
    return original(householdId, entry);
  });
}

/** Fails every write and read of the audit log's database — the route's and the worker's — until restored. */
function failAuditDatabase(secret: string): void {
  vi.spyOn(db.databases.for("audit"), "inHousehold").mockImplementation(() =>
    Promise.reject(new Error(secret)),
  );
}

const dailyTasks = (householdIds: readonly string[]) =>
  schedulerDailyTasks({
    databases: db.databases,
    audit,
    spaces: { spaceIds: async () => [...householdIds], membershipOf: spaces.membershipOf },
    now: () => Date.now(),
  });

beforeAll(async () => {
  db = await setupRealModules(8);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  ledger = createLedger(db.databases.for("ledger"));
  liabilities = createLiabilities(db.databases.for("liabilities"), audit);
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        accounts: createAccountsServices({
          walletUsage: [],
          ledger,
          liabilities,
          keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
          fx: createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW }),
          audit,
          clock: { now: () => NOW },
          newId: randomUUID,
        }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

afterEach(() => vi.restoreAllMocks());

describe("pr266-sec: the audit entry is never lost and never doubled", () => {
  it("pr266-sec: a process that ends right after the commit leaves the job; retries record the class only; the entry is written once", async () => {
    const space = await newSpace();
    failAuditDatabase("secret-text-51c7");
    expect((await register(space)).kind).toBe("registered");
    // The worker's first try fails too: back in the queue, one attempt used, the error's class only.
    await runWorker(space.householdId);
    expect(await jobs(space.householdId)).toEqual([
      expect.objectContaining({ state: "queued", attempts: 1, last_error: "Error" }),
    ]);
    expect(await liabilityAudit(space.householdId, "create")).toBe(0);
    vi.restoreAllMocks();
    await db.owner.query(`UPDATE liabilities.jobs SET run_after = now() WHERE household_id = $1`, [
      space.householdId,
    ]);
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    expect(await liabilityAudit(space.householdId, "create")).toBe(1);
    expect((await jobs(space.householdId)).map((j) => j.state)).toEqual(["done"]);
  });

  it("pr266-sec: the route's write and several workers at once write one entry", async () => {
    const space = await newSpace();
    const original = audit.record.bind(audit);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = false;
    // The route's own audit write waits; meanwhile the workers take the job.
    vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
      if (!held && entry.entity.type === "liabilities.liability") {
        held = true;
        await gate;
      }
      return original(householdId, entry);
    });
    const route = register(space);
    await vi.waitFor(async () =>
      expect(await n("liabilities.jobs WHERE household_id = $1", space.householdId)).toBe(1),
    );
    await Promise.all([
      runWorker(space.householdId),
      runWorker(space.householdId),
      runWorker(space.householdId),
    ]);
    release();
    expect((await route).kind).toBe("registered");
    expect(await liabilityAudit(space.householdId, "create")).toBe(1);
    expect((await jobs(space.householdId)).map((j) => j.state)).toEqual(["done"]);
  });

  it("pr266-sec: the eighth failed try is dead-lettered with an «error» event of no data; recovery and retention in the daily order keep the job until its entry is written", async () => {
    const space = await newSpace();
    const other = await newSpace();
    failAuditDatabase("secret-text-8e0a");
    const made = await register(space);
    await register(other);
    if (made.kind !== "registered") throw new Error("not registered");
    await db.owner.query(`UPDATE liabilities.jobs SET attempts = 7 WHERE household_id = ANY($1)`, [
      [space.householdId, other.householdId],
    ]);
    await runWorker(space.householdId, other.householdId);
    expect(await jobs(space.householdId)).toEqual([
      expect.objectContaining({ state: "dead", attempts: 8, last_error: "Error" }),
    ]);
    const dead = telemetry.memory.logRecords().filter((r) => r.body === "job.dead_lettered");
    expect(dead.map((r) => [r.severityText, r.attributes])).toEqual(
      Array(2).fill([
        "ERROR",
        {
          "ws.module": "liabilities",
          "ws.job.name": "liabilities.hand-off",
          "error.type": "Error",
          "ws.job.attempts": 8,
        },
      ]),
    );
    const text = await exportedText(telemetry);
    for (const secret of ["secret-text-8e0a", space.householdId, made.liability.id, space.accountId, "650"])
      expect(text).not.toContain(secret);
    vi.restoreAllMocks();
    // Dead for longer than the retention keeps a dead job (30 days): the daily order puts it back before it is purged.
    await db.owner.query(
      `UPDATE liabilities.jobs SET finished_at = now() - interval '45 days' WHERE household_id = ANY($1)`,
      [[space.householdId, other.householdId]],
    );
    // A done job and a job of another name are not this recovery's.
    await db.owner.query(
      `INSERT INTO liabilities.jobs (household_id, name, dedupe_key, payload, state, attempts, finished_at)
       VALUES ($1, 'liabilities.hand-off', 'create:done-one', '{}', 'done', 1, now()),
              ($1, 'liabilities.other-job', 'k', '{}', 'dead', 8, now())`,
      [space.householdId],
    );
    const tasks = dailyTasks([space.householdId]);
    const order = tasks.map((t) => t.name);
    for (const name of order.filter(
      (x) => x === "liabilities.hand-off-recovery" || x === "queue.retention-cleanup",
    ))
      await tasks.find((t) => t.name === name)!.run();
    const after = (await jobs(space.householdId)).map((j) => [
      j.dedupe_key.split(":")[0],
      j.state,
      j.attempts,
    ]);
    expect(after).toHaveLength(3);
    expect(after).toEqual(
      expect.arrayContaining([
        ["create", "queued", 0],
        ["create", "done", 1],
        ["k", "dead", 8],
      ]),
    );
    // The space the scheduler was not given keeps its dead job as it was (recovery works per space).
    expect((await jobs(other.householdId)).map((j) => j.state)).toEqual(["dead"]);
    await runWorker(space.householdId);
    expect(await liabilityAudit(space.householdId, "create")).toBe(1);
    expect(await liabilityAudit(other.householdId, "create")).toBe(0);
    // Recovery again changes nothing (idempotent), and the entry stays one.
    await tasks.find((t) => t.name === "liabilities.hand-off-recovery")!.run();
    await runWorker(space.householdId);
    expect(await liabilityAudit(space.householdId, "create")).toBe(1);
  });

  it("pr266-sec: amounts beyond a float's precision reach the audit entry through the job digit for digit", async () => {
    const space = await newSpace();
    failLiabilityAudit();
    const made = await register(space, {
      ...loanTerms,
      annualRate: "12.34",
      monthlyPayment: "900719925474099.31",
    });
    if (made.kind !== "registered") throw new Error(JSON.stringify(made));
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    const [entry] = await audit.entriesFor(space.householdId, {
      type: "liabilities.liability",
      id: made.liability.id,
    });
    expect(entry!.changes).toEqual(
      expect.arrayContaining([
        { field: "monthlyPayment", before: null, after: "900719925474099.31", masked: false },
        { field: "annualRate", before: null, after: "12.34", masked: false },
        { field: "currency", before: null, after: "EUR", masked: false },
      ]),
    );
  });
});

describe("pr266-sec: survivors of the mutation run", () => {
  it("pr266-sec: a kind change's entry has the old terms before and the new ones after (M17)", async () => {
    const space = await newSpace();
    const accountId = randomUUID();
    const made = await register(space, loanTerms, accountId);
    if (made.kind !== "registered") throw new Error("not registered");
    // The route's own write fails, so the entry is the worker's, from the job's stored values.
    failLiabilityAudit();
    await liabilities.changeKind(space.householdId, {
      actorAccountId: space.accountId,
      accountId,
      kind: "credit-card",
    });
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    const updates = (
      await audit.entriesFor(space.householdId, { type: "liabilities.liability", id: made.liability.id })
    ).filter((e) => e.action === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.changes).toEqual(
      expect.arrayContaining([
        { field: "kind", before: "loan", after: "credit-card", masked: false },
        { field: "monthlyPayment", before: "650", after: null, masked: false },
      ]),
    );
    expect(updates[0]).toMatchObject({ actorKind: "user", actorId: space.accountId });
  });

  it("pr266-sec: the daily recovery puts back the dead jobs of every space, not only the first (M19)", async () => {
    const first = await newSpace();
    const second = await newSpace();
    const third = await newSpace();
    const all = [first.householdId, second.householdId, third.householdId];
    failLiabilityAudit();
    for (const space of [first, second, third]) await register(space);
    vi.restoreAllMocks();
    await db.owner.query(
      `UPDATE liabilities.jobs SET state = 'dead', attempts = 8, finished_at = now() WHERE household_id = ANY($1)`,
      [all],
    );
    await dailyTasks(all)
      .find((t) => t.name === "liabilities.hand-off-recovery")!
      .run();
    for (const householdId of all)
      expect((await jobs(householdId)).map((j) => [j.state, j.attempts])).toEqual([["queued", 0]]);
    expect(
      telemetry.memory
        .logRecords()
        .filter((r) => r.body === "liabilities.hand_off_requeued")
        .map((r) => [r.severityText, r.attributes]),
    ).toEqual([["WARN", { "ws.module": "liabilities" }]]);
    await runWorker(...all);
    for (const householdId of all) expect(await liabilityAudit(householdId, "create")).toBe(1);
  });
});

describe("pr266-sec: the liabilities queue keeps to its space", () => {
  it("pr266-sec: the module's role in another space neither reads, changes, deletes nor writes a space's jobs", async () => {
    const mine = await newSpace();
    const theirs = await newSpace();
    failLiabilityAudit();
    await register(mine);
    vi.restoreAllMocks();
    const asTheirs = <T>(sql: string, values: unknown[] = []) =>
      db.databases
        .for("liabilities")
        .inHousehold(theirs.householdId, async (q) => (await q.query(sql, values)).rowCount as T);
    expect(await asTheirs("SELECT 1 FROM jobs")).toBe(0);
    expect(await asTheirs("SELECT 1 FROM jobs WHERE household_id = $1", [mine.householdId])).toBe(0);
    expect(await asTheirs("UPDATE jobs SET state = 'done', payload = '{}'")).toBe(0);
    expect(await asTheirs("DELETE FROM jobs")).toBe(0);
    expect(await asTheirs("DELETE FROM outbox_events")).toBe(0);
    await expect(
      asTheirs(
        `INSERT INTO jobs (household_id, name, dedupe_key, payload) VALUES ($1, 'liabilities.hand-off', 'create:x', '{}')`,
        [mine.householdId],
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asTheirs(
        `INSERT INTO outbox_events (household_id, event_name, event_version, payload) VALUES ($1, 'liabilities.x', 1, '{}')`,
        [mine.householdId],
      ),
    ).rejects.toThrow(/row-level security/);
    // Their worker, their recovery and their erasure leave it too.
    await runWorker(theirs.householdId);
    await dailyTasks([theirs.householdId])
      .find((t) => t.name === "liabilities.hand-off-recovery")!
      .run();
    expect(
      await createLiabilitiesErasure(db.databases.for("liabilities")).eraseHousehold(theirs.householdId),
    ).toEqual({
      liabilities: 0,
      jobs: 0,
    });
    expect(await jobs(mine.householdId)).toEqual([expect.objectContaining({ state: "queued", attempts: 0 })]);
    expect(await liabilityAudit(mine.householdId, "create")).toBe(0);
    expect(await n("liabilities.liabilities WHERE household_id = $1", mine.householdId)).toBe(1);
  });

  it("pr266-sec: a forged job naming another space's liability and member writes only into its own space's log, and cannot take an entry's key", async () => {
    const mine = await newSpace();
    const theirs = await newSpace();
    const made = await register(theirs);
    if (made.kind !== "registered") throw new Error("not registered");
    await runWorker(theirs.householdId);
    const before = await spaceRows(db, theirs.householdId);
    const forged = (action: string, key: string) =>
      db.owner.query(
        `INSERT INTO liabilities.jobs (household_id, name, dedupe_key, payload) VALUES ($1, 'liabilities.hand-off', $2, $3)`,
        [
          mine.householdId,
          key,
          JSON.stringify({
            liabilityId: made.liability.id,
            actorAccountId: theirs.accountId,
            action,
            changeId: made.liability.id,
            changes: [{ field: "kind", before: null, after: "credit-card" }],
          }),
        ],
      );
    await forged("create", `create:${made.liability.id}`);
    await runWorker(mine.householdId, theirs.householdId);
    expect(await spaceRows(db, theirs.householdId)).toEqual(before);
    expect(await liabilityAudit(theirs.householdId, "create")).toBe(1);
    expect(await liabilityAudit(mine.householdId, "create")).toBe(1);
    // A payload with a field the job does not have is refused before the handler: by class, nothing written.
    await db.owner.query(
      `INSERT INTO liabilities.jobs (household_id, name, dedupe_key, payload) VALUES ($1, 'liabilities.hand-off', 'create:extra',
         jsonb_build_object('liabilityId', $2::text, 'actorAccountId', $2::text, 'action', 'create', 'changeId', $2::text,
                            'changes', '[]'::jsonb, 'note', 'secret-note-2b9d'))`,
      [mine.householdId, randomUUID()],
    );
    await db.owner.query(
      `UPDATE liabilities.jobs SET attempts = 7 WHERE household_id = $1 AND state = 'queued'`,
      [mine.householdId],
    );
    await runWorker(mine.householdId);
    const extra = (await jobs(mine.householdId)).find((j) => j.dedupe_key === "create:extra")!;
    expect(extra.state).toBe("dead");
    expect(extra.last_error).toMatch(/^[A-Za-z][A-Za-z0-9]{0,63}$/);
    expect(await liabilityAudit(mine.householdId, "create")).toBe(1);
    expect(await exportedText(telemetry)).not.toContain("secret-note-2b9d");
  });
});

describe("pr266-sec: no personal data or error text in the job, `last_error` or telemetry", () => {
  it("pr266-sec: a loan made through accounts with a failing audit write leaves names and the error text out of the liabilities queue and telemetry", async () => {
    const space = await newSpace();
    failLiabilityAudit("secret-text-a3f4 Олена Синтетична");
    const res = await call(space, "POST", "/v1/accounts", {
      kind: "loan",
      name: "Кредит Синтетичної Олени",
      balance: { amount: "5000.00", currency: "EUR" },
      balanceDate: "2026-10-01",
      annualRate: "12.5",
      monthlyPayment: "250.00",
    });
    expect(res.statusCode).toBe(201);
    await runWorker(space.householdId);
    const { rows } = await db.owner.query(`SELECT * FROM liabilities.jobs WHERE household_id = $1`, [
      space.householdId,
    ]);
    expect(rows).toHaveLength(1);
    const stored = JSON.stringify(rows);
    for (const secret of ["Кредит", "Олен", "Синтетич", "secret-text", "injected"])
      expect(stored).not.toContain(secret);
    expect(Object.keys(rows[0].payload).sort()).toEqual([
      "action",
      "actorAccountId",
      "changeId",
      "changes",
      "liabilityId",
    ]);
    for (const c of rows[0].payload.changes as { field: string; before: unknown; after: unknown }[]) {
      expect(c.field).toMatch(
        /^(accountId|kind|currency|annualRate|monthlyPayment|creditLimit|gracePeriodDays)$/,
      );
      expect(c.before).toBeNull();
      expect(c.after === null || /^[0-9a-zA-Z.-]{1,36}$/.test(c.after as string)).toBe(true);
    }
    const deferred = telemetry.memory.logRecords().filter((r) => r.body === "liabilities.hand_off_deferred");
    expect(deferred.map((r) => [r.severityText, r.attributes])).toEqual([
      ["WARN", { "ws.module": "liabilities", "error.type": "Error" }],
    ]);
    const text = await exportedText(telemetry);
    for (const secret of [
      "secret-text-a3f4",
      "Кредит Синтетичної",
      "Олена Синтетична",
      rows[0].payload.liabilityId as string,
    ])
      expect(text).not.toContain(secret);
  });
});

describe("pr266-sec: `changeKind`'s audit write under the account's row lock", () => {
  it("pr266-sec: an audit write that fails under the lock releases it; the next kind change goes through and both entries are written once", async () => {
    const space = await newSpace();
    const created = (await call(space, "POST", "/v1/accounts", card)).json();
    await runWorker(space.householdId);
    failLiabilityAudit();
    expect((await call(space, "PATCH", `/v1/accounts/${created.id}`, { kind: "loan" })).statusCode).toBe(200);
    expect(
      (await call(space, "PATCH", `/v1/accounts/${created.id}`, { kind: "credit-card" })).statusCode,
    ).toBe(200);
    expect((await liabilities.forAccount(space.householdId, created.id))?.kind).toBe("credit-card");
    expect(await liabilityAudit(space.householdId, "update")).toBe(0);
    // Nothing of accounts is left locked or in a transaction.
    expect(
      await n("pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'"),
    ).toBe(0);
    vi.restoreAllMocks();
    await runWorker(space.householdId);
    await runWorker(space.householdId);
    const updates = (await jobs(space.householdId)).filter((j) => j.dedupe_key.startsWith("update:"));
    expect(updates.map((j) => j.state)).toEqual(["done", "done"]);
    expect(await liabilityAudit(space.householdId, "update")).toBe(2);
  });

  it("pr266-sec: kind changes and workers at once end without a deadlock; account and liability agree; one entry per committed change", async () => {
    const space = await newSpace();
    const created = (await call(space, "POST", "/v1/accounts", card)).json();
    await runWorker(space.householdId);
    const kinds = ["loan", "credit-card", "loan", "credit-card", "loan", "credit-card"];
    const results = await Promise.all([
      ...kinds.map((kind) => call(space, "PATCH", `/v1/accounts/${created.id}`, { kind })),
      runWorker(space.householdId),
      runWorker(space.householdId),
    ]);
    for (const r of results.slice(0, kinds.length))
      expect([200, 409]).toContain((r as { statusCode: number }).statusCode);
    for (let i = 0; i < 4; i++) {
      await db.owner.query(
        `UPDATE accounts.jobs SET run_after = now() WHERE household_id = $1 AND state = 'queued'`,
        [space.householdId],
      );
      await db.owner.query(
        `UPDATE liabilities.jobs SET run_after = now() WHERE household_id = $1 AND state = 'queued'`,
        [space.householdId],
      );
      await runWorker(space.householdId);
    }
    expect(await n("accounts.jobs WHERE household_id = $1 AND state <> 'done'", space.householdId)).toBe(0);
    expect(await n("liabilities.jobs WHERE household_id = $1 AND state <> 'done'", space.householdId)).toBe(
      0,
    );
    const account = (await call(space, "GET", `/v1/accounts/${created.id}`)).json();
    expect((await liabilities.forAccount(space.householdId, created.id))?.kind).toBe(account.kind);
    const committed = await n(
      "liabilities.jobs WHERE household_id = $1 AND dedupe_key LIKE 'update:%'",
      space.householdId,
    );
    expect(await liabilityAudit(space.householdId, "update")).toBe(committed);
    expect(
      await n(
        "pg_locks l JOIN pg_stat_activity a USING (pid) WHERE a.datname = current_database() AND NOT l.granted",
      ),
    ).toBe(0);
  }, 60_000);
});

describe("pr266-sec: the owner's erasure takes the liabilities queue", () => {
  it("pr266-sec: with the erasure roles, queued, dead and done jobs and an outbox row of the space go; the neighbour's stay", async () => {
    const person = await personWithSpace(db, "sec266");
    const neighbour = await personWithSpace(db, "sec266n");
    for (const p of [person, neighbour]) {
      await db.owner.query(
        `INSERT INTO liabilities.jobs (household_id, name, dedupe_key, payload, state, attempts, finished_at)
         VALUES ($1, 'liabilities.hand-off', 'update:a:b', '{}', 'dead', 8, now()),
                ($1, 'liabilities.hand-off', 'update:a:c', '{}', 'done', 1, now())`,
        [p.householdId],
      );
      await db.owner.query(
        `INSERT INTO liabilities.outbox_events (household_id, event_name, event_version, payload) VALUES ($1, 'liabilities.x', 1, '{}')`,
        [p.householdId],
      );
    }
    const neighbourBefore = await spaceRows(db, neighbour.householdId);
    // The fixture's create and its change of terms (FIN-12 AC10, erasure-helpers.ts), plus the dead and the done job.
    expect(neighbourBefore["liabilities.jobs"]!.startsWith("4:")).toBe(true);
    const dir = mkdtempSync(path.join(tmpdir(), "ws-sec266-"));
    try {
      const t = Date.UTC(2027, 5, 1);
      const done = await withTestErasureDatabases(db, async (erasureDatabases) => {
        const e = createDataErasure({
          databases: db.databases,
          erasureDatabases,
          log: localErasureLog({ dir }),
          now: () => t,
        });
        const request = await e.request({ accountId: person.accountId });
        return e.run(request.requestId);
      });
      expect(done).toMatchObject({ state: "completed" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const left = await spaceRows(db, person.householdId);
    for (const table of ["liabilities.jobs", "liabilities.outbox_events", "liabilities.liabilities"])
      expect(left[table]).toBe("0:");
    expect(Object.entries(left).filter(([, v]) => !v.startsWith("0:"))).toEqual([]);
    expect(await spaceRows(db, neighbour.householdId)).toEqual(neighbourBefore);
  });
});
