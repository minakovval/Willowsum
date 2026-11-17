import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { mountApi } from "../src/api.ts";
import { schedulerDailyTasks } from "../src/wiring.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { TECHNICAL_LIMITS } from "../src/platform/http/limits.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import {
  BULK_ITEMS_MAX,
  createBulkActionsErasure,
  createBulkActionsServices,
  createBulkActionsWorkerQueue,
  type BulkActionHandler,
  type BulkActionsServices,
  type BulkCaller,
  type BulkTarget,
  type BulkValues,
} from "../src/modules/bulk-actions/index.ts";
import type { HouseholdSpaces } from "../src/modules/household/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * DAT-03@PoC a) (wave 2 row 17 — the server part), through the real API and worker on a real PostgreSQL. The engine is
 * one for every entity (FR 1); the three actions of the transactions list come with their fields (rows 20, 21, 24), so
 * these tests drive it with a synthetic entity «test-records» behind the same ports a module implements: records with
 * a version and a label, kept per space, invisible to a scoped member and to every other space. Every value is
 * synthetic; the clock is the test's.
 */
const WEB = "http://localhost:5173";
const START = Date.parse("2026-10-17T10:00:00Z");
const HOUR = 60 * 60 * 1000;
let now = START;

interface Row {
  version: number;
  values: { label: string | null; group: string; locked: string | null };
}
/** «test-records»: household → id → record. */
const store = new Map<string, Map<string, Row>>();
const writes = new Map<string, number>();
/** Fails the n-th write from now (a failure in the middle of a run, AC8). */
let failAtWrite: number | null = null;

const recordsOf = (householdId: string) => {
  let m = store.get(householdId);
  if (!m) store.set(householdId, (m = new Map()));
  return m;
};

const target: BulkTarget = {
  entity: "test-records",
  async select(caller, filter, excluded, limit) {
    if (caller.scoped) return { ids: [], count: 0 };
    const groups = filter.map((f) => /^group\.eq:([a-z0-9-]{1,40})$/.exec(f)?.[1]);
    if (groups.some((g) => g === undefined)) return { invalid: true };
    const skip = new Set(excluded);
    const ids = [...recordsOf(caller.householdId)]
      .filter(([id, r]) => !skip.has(id) && groups.every((g) => r.values.group === g))
      .map(([id]) => id);
    return { ids: ids.slice(0, limit), count: ids.length };
  },
  async read(caller, ids) {
    const out = new Map();
    if (caller.scoped) return out;
    const mine = recordsOf(caller.householdId);
    for (const id of ids) {
      const r = mine.get(id);
      if (r) out.set(id, { id, version: r.version, values: { ...r.values } });
    }
    return out;
  },
  async write(caller, id, expectedVersion, values) {
    if (failAtWrite !== null && --failAtWrite === 0) {
      failAtWrite = null;
      throw new Error("injected failure");
    }
    const r = recordsOf(caller.householdId).get(id);
    if (!r) return { kind: "unavailable" };
    if (r.version !== expectedVersion) return { kind: "conflict" };
    if (values["label"] === "refused") return { kind: "invalid", issue: "label.refused" };
    r.values = { ...r.values, ...(values as Partial<Row["values"]>) };
    r.version += 1;
    writes.set(id, (writes.get(id) ?? 0) + 1);
    return { kind: "changed", version: r.version };
  },
};

const setLabel: BulkActionHandler = {
  name: "test-records.set-label",
  entity: "test-records",
  params: z.strictObject({ label: z.string().min(1).max(40) }),
  sensitiveFields: ["label"],
  async plan(_caller: BulkCaller, records, params) {
    const { label } = params as { label: string };
    return new Map(
      records.map((r) => [
        r.id,
        r.values["locked"] === "yes"
          ? { kind: "invalid" as const, issue: "record.locked" }
          : r.values["label"] === label
            ? { kind: "unchanged" as const }
            : { kind: "change" as const, after: { label } satisfies BulkValues },
      ]),
    );
  },
};

/** Plans whatever fields it is given: a handler that does not keep to the size of an audit entry (#272 item 2). */
const setRaw: BulkActionHandler = {
  name: "test-records.set-raw",
  entity: "test-records",
  params: z.strictObject({ values: z.record(z.string(), z.string().nullable()) }),
  async plan(_caller: BulkCaller, records, params) {
    const { values } = params as { values: BulkValues };
    return new Map(records.map((r) => [r.id, { kind: "change" as const, after: values }]));
  },
};

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let services: BulkActionsServices;
let app: ReturnType<typeof buildServer>;
const off = new Set<string>();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Тарас Синтетичний" });
  return { accountId, householdId };
}

function seed(space: Space, n: number, values: Partial<Row["values"]> = {}): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = randomUUID();
    recordsOf(space.householdId).set(id, {
      version: 1,
      values: { label: null, group: "g1", locked: null, ...values },
    });
    ids.push(id);
  }
  return ids;
}

const label = (space: Space, id: string) => recordsOf(space.householdId).get(id)!.values.label;

function call(
  space: Space,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  principal: { role?: string; scoped?: boolean; userId?: string } = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId, ...principal }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const byIds = (ids: readonly string[], value = "Синтетична мітка") => ({
  action: "test-records.set-label",
  selection: { kind: "ids", ids },
  params: { label: value },
});
const byFilter = (excluded: readonly string[] = [], value = "Синтетична мітка", group = "g1") => ({
  action: "test-records.set-label",
  selection: { kind: "filter", filter: [`group.eq:${group}`], excluded },
  params: { label: value },
});

async function start(space: Space, body: unknown, principal = {}) {
  const res = await call(space, "POST", "/v1/bulk-actions", body, principal);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Report;
}

interface Report {
  id: string;
  status: string;
  background: boolean;
  count: number;
  processed: number;
  changed: number;
  skipped: Record<string, number>;
  skippedRecords: { id: string; reason: string; issue: string | null }[];
  undo: { available: boolean; until: string | null; restored: number; notRestored: number };
}

const report = async (space: Space, id: string) =>
  (await call(space, "GET", `/v1/bulk-actions/${id}`)).json() as Report;

const jobsOf = async (householdId: string, state = "queued") =>
  Number(
    (
      await db.owner.query(
        `SELECT count(*)::int AS n FROM bulk_actions.jobs WHERE household_id = $1 AND state = $2`,
        [householdId, state],
      )
    ).rows[0]!.n,
  );

/** The worker as main.ts wires it for bulk actions, one pass at a time; `passes` bounds a background run. */
async function work(householdId: string, passes = 1): Promise<void> {
  const worker = createWorker({
    queues: [createBulkActionsWorkerQueue(db.databases.for("bulk-actions"), services)],
    households: async () => [householdId],
    retryDelayMs: () => 0,
  });
  try {
    for (let i = 0; i < passes; i++) {
      await worker.tick();
      await worker.idle();
    }
  } finally {
    await worker.stop();
  }
}

async function drain(householdId: string): Promise<void> {
  for (let i = 0; i < 100 && (await jobsOf(householdId)) > 0; i++) await work(householdId);
}

const groupEntries = (space: Space, id: string) =>
  audit.entriesFor(space.householdId, { type: "bulk-actions.action", id });

beforeAll(async () => {
  db = await setupRealModules(4);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  services = createBulkActionsServices({
    targets: [target],
    actions: [setLabel, setRaw],
    audit,
    clock: { now: () => now },
    newId: randomUUID,
    partSize: 20,
  });
  const base = fakeFlags();
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: { ...base, isEnabled: async (_h: string, flag: string) => !off.has(flag) },
        authenticate: testAuthenticate,
        bulkActions: services,
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe("DAT-03@PoC FR 3, FR 4: the summary before the run writes nothing", () => {
  it("DAT-03@PoC FR 3: 12 selected, 2 already with the value → «Зміниться 10, пропущено 2: без змін», nothing written", async () => {
    const space = await newSpace();
    const ids = [...seed(space, 2, { label: "Продукти" }), ...seed(space, 10)];
    const res = await call(space, "POST", "/v1/bulk-actions/preview", byIds(ids, "Продукти"));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      action: "test-records.set-label",
      count: 12,
      changes: 10,
      skipped: { unavailable: 0, unchanged: 2, conflict: 0, invalid: 0 },
      examples: [
        { id: ids[0], reason: "unchanged", issue: null },
        { id: ids[1], reason: "unchanged", issue: null },
      ],
      background: false,
      undoable: true,
    });
    expect(ids.map((id) => recordsOf(space.householdId).get(id)!.version)).toEqual(Array(12).fill(1));
    expect(
      (
        await db.owner.query(`SELECT count(*)::int AS n FROM bulk_actions.actions WHERE household_id = $1`, [
          space.householdId,
        ])
      ).rows[0]!.n,
    ).toBe(0);
  });

  it("DAT-03@PoC FR 4: the reasons — «недоступний», «без змін», «невалідний» with its code, at most 3 examples each", async () => {
    const space = await newSpace();
    const same = seed(space, 4, { label: "Мітка" });
    const locked = seed(space, 1, { locked: "yes" });
    const fresh = seed(space, 1);
    const missing = [randomUUID()];
    const res = await call(
      space,
      "POST",
      "/v1/bulk-actions/preview",
      byIds([...same, ...locked, ...fresh, ...missing], "Мітка"),
    );
    const body = res.json();
    expect(body.skipped).toEqual({ unavailable: 1, unchanged: 4, conflict: 0, invalid: 1 });
    expect(body.changes).toBe(1);
    expect(body.examples).toEqual([
      ...same.slice(0, 3).map((id) => ({ id, reason: "unchanged", issue: null })),
      { id: locked[0], reason: "invalid", issue: "record.locked" },
      { id: missing[0], reason: "unavailable", issue: null },
    ]);
  });

  it("DAT-03@PoC FR 1: «усі за фільтром» sends the filter and the unticked records, not the ids; a bad filter is 400", async () => {
    const space = await newSpace();
    const ids = seed(space, 5);
    seed(space, 3, { group: "g2" });
    const res = await call(space, "POST", "/v1/bulk-actions/preview", byFilter([ids[0]!, ids[1]!]));
    expect(res.json()).toMatchObject({ count: 3, changes: 3 });
    const bad = await call(space, "POST", "/v1/bulk-actions/preview", {
      ...byFilter(),
      selection: { kind: "filter", filter: ["label.like:%"], excluded: [] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors).toEqual([{ in: "body", path: "selection.filter", issue: "invalid" }]);
    const unknown = await call(space, "POST", "/v1/bulk-actions/preview", { ...byIds(ids), action: "x.y" });
    expect(unknown.statusCode).toBe(400);
  });
});

describe("DAT-03@PoC FR 5, FR 6: the run", () => {
  it("DAT-03@PoC FR 6: 50 records or fewer run at once — the report is final in the answer", async () => {
    const space = await newSpace();
    const ids = seed(space, 50);
    const r = await start(space, byIds(ids));
    expect(r).toMatchObject({
      status: "completed",
      background: false,
      count: 50,
      processed: 50,
      changed: 50,
    });
    expect(ids.every((id) => label(space, id) === "Синтетична мітка")).toBe(true);
    expect(r.undo.available).toBe(true);
  });

  it("DAT-03@PoC AC2: 300 «за фільтром» run in the background — «Оброблено X з 300» grows while other requests are served", async () => {
    const space = await newSpace();
    seed(space, 300);
    const r = await start(space, byFilter());
    expect(r).toMatchObject({ status: "running", background: true, count: 300, processed: 0 });
    await work(space.householdId);
    const first = await report(space, r.id);
    expect(first.processed).toBe(20);
    expect(first.status).toBe("running");
    // The user goes on working: another space-bound request meanwhile.
    expect((await call(space, "POST", "/v1/bulk-actions/preview", byFilter())).statusCode).toBe(200);
    await work(space.householdId);
    expect((await report(space, r.id)).processed).toBe(40);
    await drain(space.householdId);
    expect(await report(space, r.id)).toMatchObject({ status: "completed", processed: 300, changed: 300 });
  });

  it("DAT-03@PoC FR 5: each record goes through the target's single-edit rules — a refusal is «невалідний» with its code", async () => {
    const space = await newSpace();
    const ids = seed(space, 3);
    const r = await start(space, byIds(ids, "refused"));
    expect(r).toMatchObject({ changed: 0, skipped: { invalid: 3 } });
    expect(r.skippedRecords).toEqual(ids.map((id) => ({ id, reason: "invalid", issue: "label.refused" })));
  });

  it("DAT-03@PoC AC6: a record changed by someone else during the background run is skipped as «конфлікт»", async () => {
    const space = await newSpace();
    const ids = seed(space, 60);
    const r = await start(space, byIds(ids));
    // Another user changes the 45th record before the run reaches it.
    const other = recordsOf(space.householdId).get(ids[44]!)!;
    other.values.label = "Інша";
    other.version += 1;
    await drain(space.householdId);
    const done = await report(space, r.id);
    expect(done).toMatchObject({ status: "completed", changed: 59, skipped: { conflict: 1 } });
    expect(done.skippedRecords).toEqual([{ id: ids[44], reason: "conflict", issue: null }]);
    expect(label(space, ids[44]!)).toBe("Інша");
  });

  it("DAT-03@PoC EC1: a record changed during the action keeps the other user's value and is marked as a conflict", async () => {
    const space = await newSpace();
    const ids = seed(space, 55);
    const r = await start(space, byIds(ids));
    await work(space.householdId);
    const late = recordsOf(space.householdId).get(ids[54]!)!;
    late.values.label = "Пізніша";
    late.version += 1;
    await drain(space.householdId);
    expect((await report(space, r.id)).skippedRecords).toEqual([
      { id: ids[54], reason: "conflict", issue: null },
    ]);
    expect(label(space, ids[54]!)).toBe("Пізніша");
  });

  it("DAT-03@PoC AC7: while a background action runs, a second one is refused «Інша масова дія ще виконується»", async () => {
    const space = await newSpace();
    const r = await start(space, byIds(seed(space, 60)));
    const second = await call(space, "POST", "/v1/bulk-actions", byIds(seed(space, 3)));
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("BULK_ACTION_RUNNING");
    await drain(space.householdId);
    expect((await report(space, r.id)).status).toBe("completed");
    expect((await call(space, "POST", "/v1/bulk-actions", byIds(seed(space, 3)))).statusCode).toBe(201);
  });
});

describe("DAT-03@PoC FR 7, AC10: at most 500 records (NFR-15@PoC FR 17)", () => {
  it("DAT-03@PoC FR 7: the limit is the platform's technical limit", () => {
    expect(BULK_ITEMS_MAX).toBe(TECHNICAL_LIMITS.bulkItems);
  });

  it("DAT-03@PoC AC10: 600 selected — refused with the maximum of 500 (422 LIMIT_REACHED), by ids or by filter; 500 pass", async () => {
    const space = await newSpace();
    const ids = seed(space, 600);
    for (const body of [byIds(ids), byFilter()]) {
      for (const url of ["/v1/bulk-actions/preview", "/v1/bulk-actions"]) {
        const res = await call(space, "POST", url, body);
        expect(res.statusCode, url).toBe(422);
        expect(res.json()).toMatchObject({ code: "LIMIT_REACHED", limit: 500 });
      }
    }
    expect(
      (await call(space, "POST", "/v1/bulk-actions/preview", byFilter(ids.slice(0, 100)))).statusCode,
    ).toBe(200);
    expect(ids.every((id) => recordsOf(space.householdId).get(id)!.version === 1)).toBe(true);
  });
});

describe("DAT-03@PoC FR 8, FR 9: the report and «Відмінити»", () => {
  it("DAT-03@PoC AC3: undone 3 hours later — 9 of 10 records back, the one changed by hand stays «не відновлено»", async () => {
    now = START;
    const space = await newSpace();
    const ids = seed(space, 10, { label: "Стара" });
    const r = await start(space, byIds(ids, "Нова"));
    expect(r.undo).toMatchObject({ available: true, until: new Date(START + 24 * HOUR).toISOString() });
    now = START + 3 * HOUR;
    const manual = recordsOf(space.householdId).get(ids[3]!)!;
    manual.values.label = "Вручну";
    manual.version += 1;
    const res = await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      status: "undone",
      undo: { available: false, restored: 9, notRestored: 1 },
    });
    expect(ids.map((id) => label(space, id))).toEqual(ids.map((_, i) => (i === 3 ? "Вручну" : "Стара")));
    // Once only.
    expect((await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`)).json().code).toBe(
      "BULK_UNDO_UNAVAILABLE",
    );
    now = START;
  });

  it("DAT-03@PoC AC4: 25 hours after the end «Відмінити» is not available; a minute before the end it still is", async () => {
    now = START;
    const space = await newSpace();
    const ids = seed(space, 2);
    const r = await start(space, byIds(ids));
    now = START + 24 * HOUR - 60_000;
    expect((await report(space, r.id)).undo).toMatchObject({ available: true });
    now = START + 25 * HOUR;
    expect((await report(space, r.id)).undo).toEqual({
      available: false,
      until: null,
      restored: 0,
      notRestored: 0,
    });
    const res = await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("BULK_UNDO_UNAVAILABLE");
    expect(ids.every((id) => label(space, id) === "Синтетична мітка")).toBe(true);
    now = START;
  });

  it("DAT-03@PoC FR 8: «Відмінити» is not offered while the action still runs", async () => {
    const space = await newSpace();
    const r = await start(space, byIds(seed(space, 60)));
    expect(r.undo.available).toBe(false);
    expect((await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`)).statusCode).toBe(409);
    await drain(space.householdId);
  });
});

describe("DAT-03@PoC FR 10, AC8: an interrupted action and «Продовжити»", () => {
  it("DAT-03@PoC AC8: interrupted on the 121st of 400 — «Перервано»; «Продовжити» runs from the 121st, the first 120 are not repeated", async () => {
    const space = await newSpace();
    const ids = seed(space, 400);
    const r = await start(space, byFilter());
    await work(space.householdId, 6);
    expect((await report(space, r.id)).processed).toBe(120);
    // The restart: the part that holds the 121st record fails; the job taken again marks the action interrupted.
    failAtWrite = 1;
    await work(space.householdId);
    expect(await jobsOf(space.householdId)).toBe(1);
    await work(space.householdId);
    const stopped = await report(space, r.id);
    expect(stopped).toMatchObject({ status: "interrupted", processed: 120, changed: 120 });
    expect(await jobsOf(space.householdId)).toBe(1); // the audit entry of the part done
    await drain(space.householdId);
    expect((await call(space, "POST", `/v1/bulk-actions/${r.id}/resume`)).json().status).toBe("running");
    await drain(space.householdId);
    expect(await report(space, r.id)).toMatchObject({ status: "completed", processed: 400, changed: 400 });
    expect(ids.map((id) => writes.get(id))).toEqual(Array(400).fill(1));
    // Only an interrupted action resumes.
    expect((await call(space, "POST", `/v1/bulk-actions/${r.id}/resume`)).json().code).toBe(
      "BULK_ACTION_NOT_INTERRUPTED",
    );
  });

  it("DAT-03@PoC EC2: a record written just before the failure is not written again and counts as changed", async () => {
    const space = await newSpace();
    const ids = seed(space, 60);
    const r = await start(space, byIds(ids));
    // The 5th write of the first part fails after the first 4 were made: their outcomes roll back with the part.
    failAtWrite = 5;
    await work(space.householdId);
    await work(space.householdId);
    expect((await report(space, r.id)).status).toBe("interrupted");
    await call(space, "POST", `/v1/bulk-actions/${r.id}/resume`);
    await drain(space.householdId);
    expect(await report(space, r.id)).toMatchObject({
      status: "completed",
      changed: 60,
      skipped: { conflict: 0 },
    });
    expect(ids.map((id) => writes.get(id))).toEqual(Array(60).fill(1));
  });

  it("DAT-03@PoC FR 9, FR 11: records written before a failure count as changed even if «Продовжити» is never pressed — the group entry lists them and «Відмінити» restores them", async () => {
    const space = await newSpace();
    const ids = seed(space, 60);
    const r = await start(space, byIds(ids));
    failAtWrite = 5;
    await work(space.householdId);
    await work(space.householdId);
    expect(await report(space, r.id)).toMatchObject({ status: "interrupted", changed: 4, processed: 4 });
    await drain(space.householdId);
    const run = await groupEntries(space, r.id);
    expect(run).toHaveLength(1);
    expect(run[0]!.changes.slice(1).map((c) => c.record)).toEqual(ids.slice(0, 4));
    await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`);
    await drain(space.householdId);
    expect(ids.slice(0, 4).map((id) => label(space, id))).toEqual([null, null, null, null]);
    expect((await report(space, r.id)).undo).toMatchObject({ restored: 4, notRestored: 0 });
  });

  it("ARC-04@PoC FR 4 / DAT-03@PoC FR 10: a dead job of a run goes back to the queue with the daily recovery and the run ends", async () => {
    const space = await newSpace();
    const r = await start(space, byIds(seed(space, 60)));
    await db.owner.query(
      `UPDATE bulk_actions.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1`,
      [space.householdId],
    );
    expect(await jobsOf(space.householdId, "dead")).toBe(1);
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => now,
    });
    const names = tasks.map((t) => t.name);
    expect(names.indexOf("bulk-actions.recovery")).toBeGreaterThan(-1);
    expect(names.indexOf("bulk-actions.recovery")).toBeLessThan(names.indexOf("queue.retention-cleanup"));
    await tasks.find((t) => t.name === "bulk-actions.recovery")!.run();
    expect(await jobsOf(space.householdId, "dead")).toBe(0);
    await drain(space.householdId);
    expect(await report(space, r.id)).toMatchObject({ status: "completed", changed: 60 });
  });

  /** Owner rule 2026-11-15: every job of the module has a `dead` test with the daily recovery. */
  const recoverDead = async (space: Space) => {
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: () => now,
    });
    await tasks.find((t) => t.name === "bulk-actions.recovery")!.run();
  };
  const killQueued = async (space: Space, name: string) =>
    Number(
      (
        await db.owner.query(
          `UPDATE bulk_actions.jobs SET state = 'dead', attempts = 8
            WHERE household_id = $1 AND name = $2 AND state = 'queued'`,
          [space.householdId, name],
        )
      ).rowCount,
    );

  it("ARC-04@PoC FR 4 / DAT-03@PoC FR 11: a dead bulk-actions.audit job goes back to the queue with the daily recovery and the group entry is written", async () => {
    const space = await newSpace();
    const r = await start(space, byIds(seed(space, 60)));
    for (let i = 0; i < 10 && (await report(space, r.id)).status === "running"; i++)
      await work(space.householdId);
    expect(await killQueued(space, "bulk-actions.audit")).toBe(1);
    await drain(space.householdId);
    expect(await groupEntries(space, r.id)).toHaveLength(0);
    expect(await jobsOf(space.householdId, "dead")).toBe(1);
    await recoverDead(space);
    expect(await jobsOf(space.householdId, "dead")).toBe(0);
    await drain(space.householdId);
    expect(await groupEntries(space, r.id)).toHaveLength(1);
  });

  it("ARC-04@PoC FR 4 / DAT-03@PoC FR 9: a dead bulk-actions.undo job (the fallback of the route's own run) goes back to the queue with the daily recovery and writes nothing twice", async () => {
    const space = await newSpace();
    const ids = seed(space, 60);
    const r = await start(space, byIds(ids));
    await drain(space.householdId);
    await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`);
    expect(await killQueued(space, "bulk-actions.undo")).toBe(1);
    await drain(space.householdId);
    expect(await jobsOf(space.householdId, "dead")).toBe(1);
    await recoverDead(space);
    expect(await jobsOf(space.householdId, "dead")).toBe(0);
    await drain(space.householdId);
    expect(await jobsOf(space.householdId, "queued")).toBe(0);
    expect(ids.every((id) => label(space, id) === null)).toBe(true);
    expect(ids.map((id) => writes.get(id))).toEqual(Array(60).fill(2));
    expect((await report(space, r.id)).undo).toMatchObject({ restored: 60, notRestored: 0 });
    expect(await groupEntries(space, r.id)).toHaveLength(2);
  });
});

describe("DAT-03@PoC FR 11, AC9: one group entry in the audit log", () => {
  it("DAT-03@PoC AC9: a completed action is one group entry listing the records with values before and after", async () => {
    const space = await newSpace();
    const ids = seed(space, 3, { label: "Було" });
    const r = await start(space, byIds(ids, "Стало"));
    await drain(space.householdId);
    const entries = await groupEntries(space, r.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: space.accountId, action: "update" });
    // The label is free text: masked (П-10); the ids of the records are listed.
    expect(entries[0]!.changes).toEqual([
      { field: "action", before: null, after: "test-records.set-label", masked: false },
      ...ids.map((record) => ({ record, field: "label", before: "•••", after: "•••", masked: true })),
    ]);
  });

  it("DAT-03@PoC FR 11: «Відмінити» is a group entry too, with the restored records only", async () => {
    const space = await newSpace();
    const ids = seed(space, 2);
    const r = await start(space, byIds(ids));
    await drain(space.householdId);
    recordsOf(space.householdId).get(ids[1]!)!.version += 1;
    await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`);
    await drain(space.householdId);
    const entries = await groupEntries(space, r.id);
    expect(entries.map((e) => e.changes[0]!.field)).toEqual(["action", "undo"]);
    expect(entries[1]!.changes.slice(1).map((c) => c.record)).toEqual([ids[0]]);
  });

  it("DAT-03@PoC EC3: a record's own history shows no bulk change — it is only in the group entry", async () => {
    const space = await newSpace();
    const [id] = seed(space, 1);
    await start(space, byIds([id!]));
    await drain(space.householdId);
    expect(await audit.entriesFor(space.householdId, { type: "test-records.record", id: id! })).toEqual([]);
  });
});

describe("DAT-03@PoC AC5, AC11: another space", () => {
  it("DAT-03@PoC AC5: ids of another space are skipped as «недоступний», like ids that do not exist, and listed by id only", async () => {
    const space = await newSpace();
    const neighbour = await newSpace();
    const mine = seed(space, 2);
    const theirs = seed(neighbour, 2, { label: "Сусідська таємниця" });
    const missing = randomUUID();
    const r = await start(space, byIds([...mine, ...theirs, missing]));
    expect(r).toMatchObject({ changed: 2, skipped: { unavailable: 3 } });
    expect(r.skippedRecords).toEqual(
      [...theirs, missing].map((id) => ({ id, reason: "unavailable", issue: null })),
    );
    expect(JSON.stringify(r)).not.toContain("Сусідська");
    expect(theirs.map((id) => label(neighbour, id))).toEqual(["Сусідська таємниця", "Сусідська таємниця"]);
  });

  it("DAT-03@PoC AC11: a user outside the space gets «not found» — no records, counts or sums of the space", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const ids = seed(space, 3);
    const r = await start(space, byIds(ids.slice(0, 1)));
    for (const [method, url] of [
      ["GET", `/v1/bulk-actions/${r.id}`],
      ["POST", `/v1/bulk-actions/${r.id}/undo`],
      ["POST", `/v1/bulk-actions/${r.id}/resume`],
    ] as const) {
      const res = await call(stranger, method, url);
      expect(res.statusCode, url).toBe(404);
      expect(res.body).not.toMatch(/count|changed|skipped/);
    }
    for (const url of ["/v1/bulk-actions/preview", "/v1/bulk-actions"]) {
      const res = await call(stranger, "POST", url, byIds(ids));
      expect(res.statusCode, url).toBe(404);
      expect(res.body).not.toMatch(/count|changed|skipped/);
    }
    expect(ids.slice(1).every((id) => label(space, id) === null)).toBe(true);
  });

  it("DAT-03@PoC «Права доступу»: another account of the same space does not see the action (only its author)", async () => {
    const space = await newSpace();
    const r = await start(space, byIds(seed(space, 1)));
    expect(
      (await call(space, "GET", `/v1/bulk-actions/${r.id}`, undefined, { userId: randomUUID() })).statusCode,
    ).toBe(404);
  });
});

describe("DAT-03@PoC «Права доступу», «Ліміти плану»", () => {
  it.each(["owner", "admin", "editor"])(
    "DAT-03@PoC «Права доступу»: a %s previews, runs and undoes",
    async (role) => {
      const space = await newSpace();
      const ids = seed(space, 2);
      expect((await call(space, "POST", "/v1/bulk-actions/preview", byIds(ids), { role })).statusCode).toBe(
        200,
      );
      const res = await call(space, "POST", "/v1/bulk-actions", byIds(ids), { role });
      expect(res.statusCode).toBe(201);
      expect(
        (await call(space, "POST", `/v1/bulk-actions/${res.json().id}/undo`, undefined, { role })).statusCode,
      ).toBe(200);
    },
  );

  it.each([
    ["viewer", {}],
    ["advisor", {}],
    ["editor", { scoped: true }],
  ] as const)(
    "DAT-03@PoC «Права доступу»: a %s %o changes nothing (403) and a scoped member sees no action",
    async (role, extra) => {
      const space = await newSpace();
      const ids = seed(space, 2);
      const r = await start(space, byIds(ids.slice(0, 1)));
      const who = { role, ...extra };
      expect((await call(space, "POST", "/v1/bulk-actions/preview", byIds(ids), who)).statusCode).toBe(403);
      expect((await call(space, "POST", "/v1/bulk-actions", byIds(ids), who)).statusCode).toBe(403);
      expect((await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`, undefined, who)).statusCode).toBe(
        403,
      );
      expect((await call(space, "POST", `/v1/bulk-actions/${r.id}/resume`, undefined, who)).statusCode).toBe(
        403,
      );
      if ("scoped" in extra)
        expect((await call(space, "GET", `/v1/bulk-actions/${r.id}`, undefined, who)).statusCode).toBe(404);
      expect(label(space, ids[1]!)).toBe(null);
    },
  );

  it("DAT-03@PoC «Ліміти плану»: behind the flag `data.bulk_actions` — off, the routes do not exist (404) and nothing runs", async () => {
    const space = await newSpace();
    const ids = seed(space, 2);
    off.add("data.bulk_actions");
    try {
      expect((await call(space, "POST", "/v1/bulk-actions", byIds(ids))).statusCode).toBe(404);
    } finally {
      off.delete("data.bulk_actions");
    }
    expect(label(space, ids[0]!)).toBe(null);
  });
});

describe("NFR-12@PoC FR 3: erasure", () => {
  it("NFR-12@PoC FR 3: the space's erasure takes its bulk actions, their records' values and their queue rows", async () => {
    const space = await newSpace();
    const neighbour = await newSpace();
    await start(space, byIds(seed(space, 2)));
    await start(neighbour, byIds(seed(neighbour, 1)));
    const erased = await createBulkActionsErasure(db.databases.for("bulk-actions")).eraseHousehold(
      space.householdId,
    );
    expect(erased).toMatchObject({ actions: 1, jobs: 2 });
    const left = async (h: string) =>
      (
        await db.owner.query(
          `SELECT (SELECT count(*) FROM bulk_actions.actions WHERE household_id = $1)::int
                + (SELECT count(*) FROM bulk_actions.items WHERE household_id = $1)::int AS n`,
          [h],
        )
      ).rows[0]!.n;
    expect(await left(space.householdId)).toBe(0);
    expect(await left(neighbour.householdId)).toBe(2);
  });
});

describe("DAT-03@PoC FR 11 (#272 item 2): the size of a record's part of the group audit entry is bounded by the engine", () => {
  const raw = (ids: readonly string[], values: Record<string, string | null>) => ({
    action: "test-records.set-raw",
    selection: { kind: "ids", ids },
    params: { values },
  });

  it("DAT-03@PoC FR 11: a plan with a value of 1001 characters or five fields is skipped as «невалідний» (audit_size), nothing is written", async () => {
    const space = await newSpace();
    const [a, b, c] = seed(space, 3);
    const preview = await call(
      space,
      "POST",
      "/v1/bulk-actions/preview",
      raw([a!], { label: "я".repeat(1001) }),
    );
    expect(preview.json()).toMatchObject({ changes: 0, skipped: { invalid: 1 } });
    expect(preview.json().examples).toEqual([{ id: a, reason: "invalid", issue: "audit_size" }]);
    const five = { label: "x", group: "g1", locked: null, a: "1", b: "2" };
    const r = await start(space, raw([b!], five));
    expect(r).toMatchObject({ status: "completed", changed: 0, skipped: { invalid: 1 } });
    expect(label(space, b!)).toBe(null);
    // The limits themselves pass: 1000 characters and four fields.
    const ok = await start(space, raw([c!], { label: "я".repeat(1000), group: "g1", locked: null, a: "1" }));
    expect(ok).toMatchObject({ changed: 1 });
    await drain(space.householdId);
    expect(await groupEntries(space, ok.id)).toHaveLength(1);
    expect(await jobsOf(space.householdId, "dead")).toBe(0);
  });

  it("DAT-03@PoC FR 11: a record whose previous value is too long for the entry is skipped too, so the undo's entry fits as well", async () => {
    const space = await newSpace();
    const [id] = seed(space, 1, { label: "ї".repeat(1500) });
    const r = await start(space, byIds([id!], "Коротка"));
    expect(r).toMatchObject({ changed: 0, skipped: { invalid: 1 } });
    expect(label(space, id!)).toBe("ї".repeat(1500));
  });
});

describe("DAT-03@PoC FR 6 (#272 item 3): idempotency keys of a bulk action belong to the account", () => {
  const withKey = (space: Space, userId: string, key: string, body: unknown) =>
    app.inject({
      method: "POST",
      url: "/v1/bulk-actions",
      headers: {
        origin: WEB,
        "idempotency-key": key,
        "content-type": "application/json",
        ...principalHeader({ userId, householdId: space.householdId }),
      },
      payload: JSON.stringify(body),
    });

  it("DAT-03@PoC FR 6: another account of the space repeating the author's key and body gets no report of the author's action", async () => {
    const space = await newSpace();
    const body = byIds(seed(space, 2));
    const key = randomUUID();
    const first = await withKey(space, space.accountId, key, body);
    expect(first.statusCode, first.body).toBe(201);
    const other = await withKey(space, randomUUID(), key, body);
    expect(other.statusCode, other.body).toBe(201);
    expect(other.headers["idempotent-replayed"]).toBeUndefined();
    expect(other.json().id).not.toBe(first.json().id);
    // The author's own repeat is still a replay of the author's report.
    const again = await withKey(space, space.accountId, key, body);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.json().id).toBe(first.json().id);
    // The key is stored as a digest: it is not in the table in the clear.
    const stored = await db.owner.query(
      `SELECT key FROM bulk_actions.idempotency_keys WHERE household_id = $1`,
      [space.householdId],
    );
    expect(stored.rows.map((r) => r.key)).not.toContain(key);
  });
});

describe("DAT-03@PoC FR 11 (#272 item 5): the undo's entry never comes before the run's", () => {
  it("DAT-03@PoC FR 11: the run's audit job is dead when the undo's job runs — the run's entry is written first, the undo's second", async () => {
    const space = await newSpace();
    const ids = seed(space, 3);
    const r = await start(space, byIds(ids));
    await db.owner.query(
      `UPDATE bulk_actions.jobs SET state = 'dead', attempts = 8, finished_at = now()
        WHERE household_id = $1 AND name = 'bulk-actions.audit' AND dedupe_key LIKE '%:run:%'`,
      [space.householdId],
    );
    await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`);
    await drain(space.householdId);
    const entries = await groupEntries(space, r.id);
    expect(entries.map((e) => e.changes[0]!.field)).toEqual(["action", "undo"]);
    expect(entries[0]!.changes.slice(1).map((c) => c.record)).toEqual(ids);
    // The recovered run job appends nothing more.
    await db.owner.query(
      `UPDATE bulk_actions.jobs SET state = 'queued', attempts = 0, finished_at = NULL WHERE household_id = $1 AND state = 'dead'`,
      [space.householdId],
    );
    await drain(space.householdId);
    expect(await groupEntries(space, r.id)).toHaveLength(2);
  });
});

describe("#280 security (#272 item 5): the undo's entry comes after the entries of every run, the last one too", () => {
  it("DAT-03@PoC FR 11: two runs (interrupted, «Продовжити»), both runs' audit jobs dead — the undo writes run 1, run 2, then itself", async () => {
    const space = await newSpace();
    const ids = seed(space, 60);
    const r = await start(space, byIds(ids));
    failAtWrite = 5;
    await work(space.householdId);
    await work(space.householdId);
    expect(await report(space, r.id)).toMatchObject({ status: "interrupted", changed: 4 });
    const killRunAudits = () =>
      db.owner.query(
        `UPDATE bulk_actions.jobs SET state = 'dead', attempts = 8, finished_at = now()
          WHERE household_id = $1 AND name = 'bulk-actions.audit' AND dedupe_key LIKE '%:run:%' AND state = 'queued'`,
        [space.householdId],
      );
    await killRunAudits();
    await call(space, "POST", `/v1/bulk-actions/${r.id}/resume`);
    for (let i = 0; i < 20 && (await report(space, r.id)).status !== "completed"; i++)
      await work(space.householdId);
    expect(await report(space, r.id)).toMatchObject({ status: "completed", changed: 60 });
    await killRunAudits();
    expect(await groupEntries(space, r.id)).toHaveLength(0);
    await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`);
    await drain(space.householdId);
    const entries = await groupEntries(space, r.id);
    expect(entries.map((e) => e.changes[0]!.field)).toEqual(["action", "action", "undo"]);
    expect(entries[0]!.changes.slice(1).map((c) => c.record)).toEqual(ids.slice(0, 4));
    expect(entries[1]!.changes.slice(1).map((c) => c.record)).toEqual(ids.slice(4));
  });
});
