import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import {
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
const now = START;

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
    actions: [setLabel],
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

const actionRows = async (householdId: string) =>
  Number(
    (
      await db.owner.query(`SELECT count(*)::int AS n FROM bulk_actions.actions WHERE household_id = $1`, [
        householdId,
      ])
    ).rows[0]!.n,
  );

describe("PR 268 security probes: DAT-03@PoC FR 11, FR 9 — an interrupted action loses no change", () => {
  it("DAT-03@PoC FR 11: records written before the failure of an interrupted part are in a group audit entry even with no «Продовжити»", async () => {
    const space = await newSpace();
    const ids = seed(space, 60);
    const r = await start(space, byIds(ids, "Синтетика"));
    failAtWrite = 5; // writes 1–4 reach the target, the part's transaction rolls back
    await work(space.householdId);
    await work(space.householdId);
    expect((await report(space, r.id)).status).toBe("interrupted");
    await drain(space.householdId);
    const written = ids.filter((id) => label(space, id) === "Синтетика");
    expect(written).toHaveLength(4);
    const audited = (await groupEntries(space, r.id)).flatMap((e) => e.changes.map((c) => c.record));
    expect(audited).toEqual(expect.arrayContaining(written));
  });

  it("DAT-03@PoC FR 9: «Відмінити» of an interrupted action restores the records written before the failure", async () => {
    const space = await newSpace();
    const ids = seed(space, 60);
    const r = await start(space, byIds(ids, "Синтетика"));
    failAtWrite = 5;
    await work(space.householdId);
    await work(space.householdId);
    await drain(space.householdId);
    expect((await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`)).statusCode).toBe(200);
    await drain(space.householdId);
    expect(ids.filter((id) => label(space, id) !== null)).toEqual([]);
  });
});

describe("PR 268 security probes: DAT-03@PoC FR 6, AC7 — one running action per account under a race", () => {
  it("DAT-03@PoC AC7: two background starts at the same moment — exactly one runs, the other is 409 BULK_ACTION_RUNNING", async () => {
    const space = await newSpace();
    const a = seed(space, 60);
    const b = seed(space, 60);
    const res = await Promise.all([
      call(space, "POST", "/v1/bulk-actions", byIds(a)),
      call(space, "POST", "/v1/bulk-actions", byIds(b)),
      call(space, "POST", "/v1/bulk-actions", byIds([...a.slice(0, 30), ...b.slice(0, 30)])),
    ]);
    const codes = res.map((x) => x.statusCode).sort();
    expect(codes).toEqual([201, 409, 409]);
    expect(
      res.filter((x) => x.statusCode === 409).every((x) => x.json().code === "BULK_ACTION_RUNNING"),
    ).toBe(true);
    expect(await actionRows(space.householdId)).toBe(1);
  });
});

describe("PR 268 security probes: DAT-03@PoC FR 7 — the 500 cap is the server's", () => {
  it("DAT-03@PoC FR 7: 501 distinct ids or 501 by filter (none excluded) are 422 and store nothing; 500 ids with repeats pass", async () => {
    const space = await newSpace();
    const ids = seed(space, 501);
    for (const body of [byIds(ids), byFilter()]) {
      for (const url of ["/v1/bulk-actions/preview", "/v1/bulk-actions"]) {
        const res = await call(space, "POST", url, body);
        expect(res.statusCode, url).toBe(422);
        expect(res.json()).toMatchObject({ code: "LIMIT_REACHED", limit: 500 });
      }
    }
    // Upper-case duplicates of the same ids are one record each.
    const dup = [...ids.slice(0, 500), ...ids.slice(0, 10).map((x) => x.toUpperCase())];
    const ok = await call(space, "POST", "/v1/bulk-actions/preview", byIds(dup));
    expect(ok.json().count).toBe(500);
    expect(await actionRows(space.householdId)).toBe(0);
  });
});

describe("PR 268 security probes: DAT-03@PoC FR 8, FR 9 — «Відмінити»", () => {
  it("DAT-03@PoC FR 8: another account of the space, a scoped member and a stranger cannot undo; nothing is restored", async () => {
    const space = await newSpace();
    const stranger = await newSpace();
    const ids = seed(space, 2);
    const r = await start(space, byIds(ids));
    const other = await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`, undefined, {
      userId: randomUUID(),
    });
    const random = await call(space, "POST", `/v1/bulk-actions/${randomUUID()}/undo`);
    expect(other.statusCode).toBe(404);
    expect(other.json().code).toBe(random.json().code);
    expect((await call(stranger, "POST", `/v1/bulk-actions/${r.id}/undo`)).statusCode).toBe(404);
    const scoped = await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`, undefined, { scoped: true });
    expect([403, 404]).toContain(scoped.statusCode);
    await drain(space.householdId);
    expect(ids.map((id) => label(space, id))).toEqual(["Синтетична мітка", "Синтетична мітка"]);
    expect((await report(space, r.id)).undo.available).toBe(true);
  });

  it("DAT-03@PoC FR 9: undo twice writes once; a record deleted or changed later is never resurrected or overwritten", async () => {
    const space = await newSpace();
    const ids = seed(space, 3, { label: "Було" });
    const r = await start(space, byIds(ids, "Стало"));
    await drain(space.householdId);
    recordsOf(space.householdId).delete(ids[0]!);
    const later = recordsOf(space.householdId).get(ids[1]!)!;
    later.values = { ...later.values, label: "Пізніше" };
    later.version += 1;
    const first = await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`);
    expect(first.statusCode).toBe(200);
    const second = await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`);
    expect(second.json().code).toBe("BULK_UNDO_UNAVAILABLE");
    await drain(space.householdId);
    await drain(space.householdId);
    expect(recordsOf(space.householdId).has(ids[0]!)).toBe(false);
    expect(label(space, ids[1]!)).toBe("Пізніше");
    expect(label(space, ids[2]!)).toBe("Було");
    expect(writes.get(ids[2]!)).toBe(2);
    expect((await report(space, r.id)).undo).toMatchObject({ restored: 1, notRestored: 2 });
    expect((await groupEntries(space, r.id)).map((e) => e.changes[0]!.field)).toEqual(["action", "undo"]);
  });
});

describe("PR 268 security probes: ARC-04, П-10 — job payloads hold identifiers only", () => {
  it("DAT-03@PoC FR 11: no job payload carries a value, a label or a record id list", async () => {
    const space = await newSpace();
    const ids = seed(space, 60, { label: "Було" });
    const r = await start(space, byIds(ids, "Секретна синтетика"));
    await drain(space.householdId);
    await call(space, "POST", `/v1/bulk-actions/${r.id}/undo`);
    await drain(space.householdId);
    const { rows } = await db.owner.query<{ payload: Record<string, unknown>; last_error: string | null }>(
      `SELECT payload, last_error FROM bulk_actions.jobs WHERE household_id = $1`,
      [space.householdId],
    );
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows) {
      expect(Object.keys(row.payload).every((k) => ["actionId", "run", "part", "kind"].includes(k))).toBe(
        true,
      );
      expect(JSON.stringify(row)).not.toMatch(/Секретна|Було/);
    }
  });
});

describe("PR 268 security probes: DAT-03@PoC FR 6, AC7 — the database refuses a second running action", () => {
  it("DAT-03@PoC AC7: two transactions that both saw no running action — the second insert is refused, not stored", async () => {
    const { bulkStore } = await import("../src/modules/bulk-actions/adapters/db/store.ts");
    const space = await newSpace();
    const bulkDb = db.databases.for("bulk-actions");
    const action = (id: string) => ({
      id,
      actorId: space.accountId,
      action: "test-records.set-label",
      entity: "test-records",
      params: { label: "x" },
      background: true,
      status: "running" as const,
      run: 1,
      count: 1,
      createdAt: now,
      endedAt: null,
      undoneAt: null,
    });
    const item = {
      position: 1,
      recordId: randomUUID(),
      versionBefore: null,
      before: null,
      after: null,
      outcome: "unavailable" as const,
      issue: null,
      versionAfter: null,
      run: null,
      undo: null,
    };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let inserted!: () => void;
    const first = new Promise<void>((r) => (inserted = r));
    const a = bulkDb.inHousehold(space.householdId, async (q) => {
      const s = bulkStore(q);
      expect(await s.hasRunning(space.accountId)).toBe(false);
      const ok = await s.insertAction(action(randomUUID()), [item]);
      inserted();
      await gate;
      return ok;
    });
    await first;
    const b = bulkDb.inHousehold(space.householdId, async (q) => {
      const s = bulkStore(q);
      expect(await s.hasRunning(space.accountId)).toBe(false); // A has not committed yet
      const pending = s.insertAction(action(randomUUID()), [{ ...item, recordId: randomUUID() }]);
      setTimeout(release, 200);
      return pending;
    });
    expect(await Promise.all([a, b])).toEqual([true, false]);
    expect(await actionRows(space.householdId)).toBe(1);
  });
});

describe("PR 268 security probes: DAT-03@PoC FR 11 — each run's group entry lists only its own records", () => {
  it("DAT-03@PoC FR 11: interrupted after 20 of 60 and resumed — two entries, every record exactly once", async () => {
    const space = await newSpace();
    const ids = seed(space, 60);
    const r = await start(space, byIds(ids));
    await work(space.householdId); // part 1: 20 records
    failAtWrite = 1;
    await work(space.householdId); // part 2 fails before any write
    await work(space.householdId); // retried: interrupted
    expect((await report(space, r.id)).status).toBe("interrupted");
    await drain(space.householdId);
    await call(space, "POST", `/v1/bulk-actions/${r.id}/resume`);
    await drain(space.householdId);
    const entries = await groupEntries(space, r.id);
    expect(entries).toHaveLength(2);
    const perEntry = entries.map((e) => e.changes.slice(1).map((c) => c.record!));
    expect(perEntry.map((x) => x.length)).toEqual([20, 40]);
    expect([...perEntry[0]!, ...perEntry[1]!].sort()).toEqual([...ids].sort());
  });
});
