import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import {
  memoryObjectStorage,
  type MemoryObjectStorage,
} from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { createWorker } from "../src/platform/queue/index.ts";
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { schedulerDailyTasks, workerQueues } from "../src/wiring.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { csv, xls } from "../src/modules/file-storage/synthetic-files.ts";
import { STATEMENT_ROWS } from "../src/modules/file-storage/synthetic-files.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createImportSessionsServices } from "../src/modules/import-sessions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * IMP-01@PoC b) part 2 (wave 2 row 39), the module `import-sessions` through the real API on a real PostgreSQL, with the
 * test object storage: «Скасувати», «Видалити» with the originals, the daily cleanup of unapplied batches after 30 days
 * (IMP-01 FR 12, FR 20, AC9, EC4; IMP-19 FR 6, AC2), the space's boundary on both routes, the audit entries and the
 * dead-job recovery of the cleanup's hand-off (ARC-04, #249), and a full batch that never grows (issue 582). Every file
 * and name is synthetic; the clock is the test's.
 */
const WEB = "http://localhost:5173";
let now = Date.parse("2026-11-19T10:00:00Z");
const clock = { now: () => now };

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let objects: MemoryObjectStorage;
let files: FileStorage;
let flags = fakeFlags();
let app: ReturnType<typeof buildServer>;
const telemetry = testTelemetryForFile();

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName: "Олена Синтетична" });
  return { accountId, householdId };
}

const who = (space: Space, scoped = false) =>
  principalHeader({
    userId: space.accountId,
    householdId: space.householdId,
    ...(scoped ? { role: "viewer", scoped: true } : {}),
  });

function call(space: Space, method: "GET" | "POST" | "DELETE", url: string, body?: unknown, scoped = false) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...who(space, scoped),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

/** A `multipart/form-data` body of file parts (the web app's upload). */
function multipart(parts: readonly { readonly name: string; readonly bytes: Buffer }[]) {
  const boundary = `ws-${randomUUID()}`;
  const chunks = parts.flatMap((p) => [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${p.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    p.bytes,
    Buffer.from("\r\n"),
  ]);
  return {
    payload: Buffer.concat([...chunks, Buffer.from(`--${boundary}--\r\n`)]),
    type: `multipart/form-data; boundary=${boundary}`,
  };
}

function upload(
  space: Space,
  batchId: string,
  parts: readonly { readonly name: string; readonly bytes: Buffer }[],
) {
  const body = multipart(parts);
  return app.inject({
    method: "POST",
    url: `/v1/import/batches/${batchId}/files`,
    headers: { origin: WEB, ...who(space), "content-type": body.type },
    payload: body.payload,
  });
}

async function newBatch(space: Space, name?: string): Promise<string> {
  const res = await call(space, "POST", "/v1/import/batches", name ? { name } : {});
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function n(sql: string, ...values: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]!.n;
}

const objectsOf = (householdId: string) => [...objects.objects.keys()].filter((k) => k.includes(householdId));
const batchAudit = (householdId: string, action: string) =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = 'import-sessions.batch' AND action = $2",
    householdId,
    action,
  );

async function runWorker(householdId: string): Promise<void> {
  const worker = createWorker({ ...workerQueues(db.databases), households: async () => [householdId] });
  try {
    await worker.tick();
    await worker.idle();
  } finally {
    await worker.stop();
  }
}

const STATEMENT = csv();
const TSV = csv(STATEMENT_ROWS, "\t");

beforeAll(async () => {
  db = await setupRealModules(6);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  objects = memoryObjectStorage();
  files = createFileStorage({
    db: db.databases.for("file-storage"),
    audit,
    keys: createSpaceKeys(db.databases.for("household"), audit, localKeyManagement()),
    objects,
    linkKey: linkKey(randomBytes(32)),
    now: () => new Date(clock.now()),
  });
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: {
          isModuleAvailable: (m) => flags.isModuleAvailable(m),
          moduleState: (m) => flags.moduleState(m),
          isEnabled: (h, f) => flags.isEnabled(h, f),
        },
        authenticate: testAuthenticate,
        importSessions: createImportSessionsServices({ files, audit, clock, newId: randomUUID }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

afterEach(() => {
  vi.restoreAllMocks();
  flags = fakeFlags();
  now = Date.parse("2026-11-19T10:00:00Z");
});

const DAY = 24 * 60 * 60 * 1000;
const cancel = (space: Space, batchId: string) => call(space, "POST", `/v1/import/batches/${batchId}/cancel`);
const remove = (space: Space, batchId: string) => call(space, "DELETE", `/v1/import/batches/${batchId}`);
const MACROS = () => xls({ extra: [{ name: "_VBA_PROJECT_CUR" }] });
const PROBLEM_KEYS = ["code", "status", "supportId", "title", "type"];

function dailyTasks(householdId: string, withFiles = true) {
  return schedulerDailyTasks({
    databases: db.databases,
    audit,
    spaces: { spaceIds: async () => [householdId], membershipOf: spaces.membershipOf },
    now: clock.now,
    ...(withFiles ? { files } : {}),
  });
}
const cleanup = (householdId: string) =>
  dailyTasks(householdId)
    .find((t) => t.name === "import-sessions.cleanup")!
    .run();

async function setState(batchId: string, state: string): Promise<void> {
  await db.owner.query(`UPDATE import_sessions.batches SET state = $2 WHERE id = $1`, [batchId, state]);
}

async function batchIds(householdId: string): Promise<string[]> {
  const { rows } = await db.owner.query<{ id: string }>(
    `SELECT id FROM import_sessions.batches WHERE household_id = $1`,
    [householdId],
  );
  return rows.map((r) => r.id).sort();
}

describe("IMP-01@PoC FR 12: «Скасувати»", () => {
  it("IMP-01@PoC FR 12: «Скасувати» closes the batch without writing; a second cancel and an upload to it are refused (409); its originals stay until it is deleted", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    await upload(space, batchId, [{ name: "a.csv", bytes: STATEMENT }]);
    now += 60_000;
    const cancelled = await cancel(space, batchId);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json()).toMatchObject({
      id: batchId,
      state: "cancelled",
      files: { accepted: 1, rejected: 0 },
      lastActionAt: new Date(now).toISOString(),
    });
    const again = await cancel(space, batchId);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("BATCH_STATE_CONFLICT");
    expect((await upload(space, batchId, [{ name: "b.csv", bytes: STATEMENT }])).statusCode).toBe(409);
    expect(await n("file_storage.files WHERE household_id = $1", space.householdId)).toBe(1);
    expect((await call(space, "GET", `/v1/import/batches/${batchId}`)).json().state).toBe("cancelled");
  });

  it("IMP-01@PoC FR 10: an applied or rolled-back batch is not cancelled; IMP-01@PoC FR 12: nor deleted (roll back first)", async () => {
    const space = await newSpace();
    const applied = await newBatch(space);
    const rolledBack = await newBatch(space);
    await setState(applied, "applied");
    await setState(rolledBack, "rolled-back");
    for (const batchId of [applied, rolledBack]) {
      expect((await cancel(space, batchId)).json().code).toBe("BATCH_STATE_CONFLICT");
      const del = await remove(space, batchId);
      expect(del.statusCode).toBe(409);
      expect(del.json().code).toBe("BATCH_STATE_CONFLICT");
    }
    expect(await batchIds(space.householdId)).toEqual([applied, rolledBack].sort());
  });
});

describe("IMP-01@PoC FR 12, EC4: «Видалити»", () => {
  it("IMP-01@PoC FR 12, EC4: «Видалити» removes an unapplied batch with its originals; its old signed link opens nothing", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    const up = await upload(space, batchId, [
      { name: "a.csv", bytes: STATEMENT },
      { name: "b.tsv", bytes: TSV },
      { name: "m.xls", bytes: MACROS() },
    ]);
    expect(up.statusCode, up.body).toBe(201);
    const token = (
      await call(space, "POST", `/v1/import/batches/${batchId}/files/${up.json().files[0].id}/link`)
    ).json().token as string;
    expect(objectsOf(space.householdId)).toHaveLength(2);
    const del = await remove(space, batchId);
    expect(del.statusCode, del.body).toBe(200);
    expect(del.json()).toEqual({ deleted: true });
    expect(objectsOf(space.householdId)).toHaveLength(0);
    expect(await n("file_storage.files WHERE household_id = $1", space.householdId)).toBe(0);
    expect(await n("import_sessions.batches WHERE id = $1", batchId)).toBe(0);
    expect(await n("import_sessions.batch_files WHERE batch_id = $1", batchId)).toBe(0);
    expect((await call(space, "GET", `/v1/import/batches/${batchId}`)).statusCode).toBe(404);
    expect((await call(space, "GET", `/v1/import/originals/${token}`)).statusCode).toBe(404);
    expect((await remove(space, batchId)).statusCode).toBe(404);
    expect((await call(space, "GET", "/v1/import/batches")).json().items).toEqual([]);
  });

  it("IMP-01@PoC FR 12: a cancelled batch and a failed one («не вдалося розібрати») are deleted too", async () => {
    const space = await newSpace();
    const cancelled = await newBatch(space);
    await upload(space, cancelled, [{ name: "a.csv", bytes: STATEMENT }]);
    await cancel(space, cancelled);
    const failed = await newBatch(space);
    await upload(space, failed, [{ name: "m.xls", bytes: MACROS() }]);
    expect((await call(space, "GET", `/v1/import/batches/${failed}`)).json().state).toBe("failed");
    expect((await remove(space, cancelled)).statusCode).toBe(200);
    expect((await remove(space, failed)).statusCode).toBe(200);
    expect(await batchIds(space.householdId)).toEqual([]);
    expect(objectsOf(space.householdId)).toHaveLength(0);
  });

  it("IMP-01@PoC FR 12: two deletions at once — one deletes, the other is «not found»; a deletion racing an upload leaves no original behind", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    await upload(space, batchId, [{ name: "a.csv", bytes: STATEMENT }]);
    const both = await Promise.all([remove(space, batchId), remove(space, batchId)]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 404]);
    const raced = await newBatch(space);
    const [up, del] = await Promise.all([
      upload(space, raced, [
        { name: "b.csv", bytes: STATEMENT },
        { name: "c.tsv", bytes: TSV },
      ]),
      remove(space, raced),
    ]);
    expect([201, 404]).toContain(up.statusCode);
    expect(del.statusCode).toBe(200);
    expect(await batchIds(space.householdId)).toEqual([]);
    expect(await n("file_storage.files WHERE household_id = $1", space.householdId)).toBe(0);
    expect(objectsOf(space.householdId)).toHaveLength(0);
  });

  it("IMP-01@PoC FR 21: the cancellation and the deletion are audit entries — the state and the count of files, never a name", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space, "Секретна назва");
    await upload(space, batchId, [{ name: "secret-name.csv", bytes: STATEMENT }]);
    await cancel(space, batchId);
    await remove(space, batchId);
    expect(await batchAudit(space.householdId, "update")).toBe(2);
    expect(await batchAudit(space.householdId, "delete")).toBe(1);
    const { rows } = await db.owner.query<{ actor_kind: string; actor_id: string; changes: unknown }>(
      `SELECT actor_kind, actor_id, changes FROM audit.entries
       WHERE household_id = $1 AND entity_type = 'import-sessions.batch' AND action = 'delete'`,
      [space.householdId],
    );
    expect(rows[0]).toMatchObject({ actor_kind: "user", actor_id: space.accountId });
    expect(rows[0]!.changes).toEqual([
      expect.objectContaining({ field: "state", before: "cancelled", after: null }),
      expect.objectContaining({ field: "files", before: "1", after: null }),
    ]);
    const text = JSON.stringify(
      (await db.owner.query(`SELECT changes FROM audit.entries WHERE household_id = $1`, [space.householdId]))
        .rows,
    );
    expect(text.includes("secret-name")).toBe(false);
    expect(text.includes("Секретна")).toBe(false);
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND entity_type = 'file-storage.file' AND action = 'delete'",
        space.householdId,
      ),
    ).toBe(1);
  });
});

describe("IMP-01@PoC FR 20, IMP-19@PoC FR 6: the daily cleanup of unapplied batches", () => {
  it("IMP-01@PoC AC9, IMP-19@PoC AC2: an open batch, a failed one and a cancelled one 30 days without an action go with their originals; applied, rolled-back and recent ones stay", async () => {
    const space = await newSpace();
    const open = await newBatch(space);
    await upload(space, open, [{ name: "a.csv", bytes: STATEMENT }]);
    const failed = await newBatch(space);
    await upload(space, failed, [{ name: "m.xls", bytes: MACROS() }]);
    const cancelled = await newBatch(space);
    await upload(space, cancelled, [{ name: "c.csv", bytes: STATEMENT }]);
    await cancel(space, cancelled);
    const applied = await newBatch(space);
    await upload(space, applied, [{ name: "b.tsv", bytes: TSV }]);
    await setState(applied, "applied");
    const rolledBack = await newBatch(space);
    await setState(rolledBack, "rolled-back");
    now += 30 * DAY + 1;
    const recent = await newBatch(space);
    await cleanup(space.householdId);
    expect(await batchIds(space.householdId)).toEqual([applied, rolledBack, recent].sort());
    expect(objectsOf(space.householdId)).toHaveLength(1);
    expect(await n("file_storage.files WHERE household_id = $1", space.householdId)).toBe(1);
    expect(await batchAudit(space.householdId, "delete")).toBe(3);
    // The cleanup's entries are the system's.
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND action = 'delete' AND actor_kind = 'system' AND channel = 'system'",
        space.householdId,
      ),
    ).toBe(5);
    // The log says how it went, never which space, batch or file.
    const cleaned = telemetry.memory.logRecords().filter((r) => r.body === "import_sessions.batches_cleaned");
    expect(cleaned.length).toBeGreaterThan(0);
    for (const r of cleaned) expect(JSON.stringify(r.attributes ?? {})).not.toContain(space.householdId);
    // A second run the same day finds nothing more.
    await cleanup(space.householdId);
    expect(await batchIds(space.householdId)).toEqual([applied, rolledBack, recent].sort());
  });

  it("IMP-01@PoC FR 20: an action within 30 days keeps the batch; exactly 30 days is not yet past", async () => {
    const space = await newSpace();
    const touched = await newBatch(space);
    const exact = await newBatch(space);
    now += 29 * DAY;
    await upload(space, touched, [{ name: "a.csv", bytes: STATEMENT }]);
    now += 1 * DAY;
    await cleanup(space.householdId);
    expect(await batchIds(space.householdId)).toEqual([exact, touched].sort());
    now += 1;
    await cleanup(space.householdId);
    expect(await batchIds(space.householdId)).toEqual([touched]);
    expect(objectsOf(space.householdId)).toHaveLength(1);
  });

  it("IMP-01@PoC FR 20: a deletion stopped half-way is «not found» at once and finished by the next cleanup", async () => {
    const space = await newSpace();
    const half = await newBatch(space);
    await upload(space, half, [{ name: "b.csv", bytes: TSV }]);
    // The original's removal fails: the mark stays, the rows stay, the answer is an error.
    vi.spyOn(files, "remove").mockRejectedValueOnce(new Error("storage down"));
    expect((await remove(space, half)).statusCode).toBe(500);
    vi.restoreAllMocks();
    expect(await n("import_sessions.batches WHERE id = $1 AND deleting_at IS NOT NULL", half)).toBe(1);
    expect((await call(space, "GET", `/v1/import/batches/${half}`)).statusCode).toBe(404);
    expect((await call(space, "GET", "/v1/import/batches")).json().items).toEqual([]);
    expect((await cancel(space, half)).statusCode).toBe(404);
    expect((await upload(space, half, [{ name: "c.csv", bytes: STATEMENT }])).statusCode).toBe(404);
    await cleanup(space.householdId);
    expect(await batchIds(space.householdId)).toEqual([]);
    expect(objectsOf(space.householdId)).toHaveLength(0);
    expect(await n("file_storage.files WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("IMP-01@PoC FR 20: one space's failure does not keep another space's stale batches; the task fails and the next run finishes", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const batchA = await newBatch(a);
    await upload(a, batchA, [{ name: "a.csv", bytes: STATEMENT }]);
    const batchB = await newBatch(b);
    await upload(b, batchB, [{ name: "b.csv", bytes: STATEMENT }]);
    now += 31 * DAY;
    const task = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [a.householdId, b.householdId], membershipOf: spaces.membershipOf },
      now: clock.now,
      files,
    }).find((t) => t.name === "import-sessions.cleanup")!;
    vi.spyOn(files, "remove").mockRejectedValueOnce(new Error("storage down"));
    await expect(task.run()).rejects.toThrow(/1 space/);
    vi.restoreAllMocks();
    expect(await batchIds(b.householdId)).toEqual([]);
    expect(objectsOf(b.householdId)).toHaveLength(0);
    expect((await call(a, "GET", `/v1/import/batches/${batchA}`)).statusCode).toBe(404);
    await task.run();
    expect(await batchIds(a.householdId)).toEqual([]);
    expect(objectsOf(a.householdId)).toHaveLength(0);
  });

  it("IMP-01@PoC FR 20: the cleanup runs only with the storage; it is one daily task of the scheduler, after the recovery of dead jobs", async () => {
    const space = await newSpace();
    expect(dailyTasks(space.householdId, false).map((t) => t.name)).not.toContain("import-sessions.cleanup");
    const names = dailyTasks(space.householdId).map((t) => t.name);
    expect(names.filter((t) => t === "import-sessions.cleanup")).toHaveLength(1);
    expect(names.indexOf("import-sessions.hand-off-recovery")).toBeLessThan(
      names.indexOf("import-sessions.cleanup"),
    );
  });

  it("ARC-04@PoC FR 4: the cleanup's audit job in state dead goes back to the queue with the daily recovery and writes the system's entry", async () => {
    const space = await newSpace();
    await newBatch(space);
    now += 31 * DAY;
    const original = audit.record.bind(audit);
    vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
      if (entry.entity.type === "import-sessions.batch" && entry.action === "delete")
        throw new Error("injected");
      return original(householdId, entry);
    });
    await cleanup(space.householdId);
    expect(await batchIds(space.householdId)).toEqual([]);
    expect(await batchAudit(space.householdId, "delete")).toBe(0);
    vi.restoreAllMocks();
    await db.owner.query(
      `UPDATE import_sessions.jobs SET state = 'dead', attempts = 8
       WHERE household_id = $1 AND payload->>'action' = 'delete'`,
      [space.householdId],
    );
    await runWorker(space.householdId);
    expect(await batchAudit(space.householdId, "delete")).toBe(0);
    await dailyTasks(space.householdId)
      .find((t) => t.name === "import-sessions.hand-off-recovery")!
      .run();
    await runWorker(space.householdId);
    expect(await batchAudit(space.householdId, "delete")).toBe(1);
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND entity_type = 'import-sessions.batch' AND action = 'delete' AND actor_kind = 'system'",
        space.householdId,
      ),
    ).toBe(1);
  });
});

describe("IMP-01@PoC «Права доступу»: cancel and delete", () => {
  it("IMP-01@PoC AC7, AC11: another space's batch is «not found» to cancel and delete, and nothing of it changes", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const batchId = await newBatch(a);
    await upload(a, batchId, [{ name: "a.csv", bytes: STATEMENT }]);
    for (const res of [await cancel(b, batchId), await remove(b, batchId)]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
      expect(Object.keys(res.json()).sort()).toEqual(PROBLEM_KEYS);
    }
    expect((await call(a, "GET", `/v1/import/batches/${batchId}`)).json()).toMatchObject({
      state: "uploaded",
      files: { accepted: 1 },
    });
    expect(objectsOf(a.householdId)).toHaveLength(1);
  });

  it("IMP-01@PoC «Права доступу»: a scoped member cannot cancel or delete; with the flag off the routes do not exist (404)", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    for (const res of [
      await call(space, "POST", `/v1/import/batches/${batchId}/cancel`, undefined, true),
      await call(space, "DELETE", `/v1/import/batches/${batchId}`, undefined, true),
    ])
      expect([403, 404]).toContain(res.statusCode);
    flags = fakeFlags({ off: ["data.import"] });
    expect((await cancel(space, batchId)).statusCode).toBe(404);
    expect((await remove(space, batchId)).statusCode).toBe(404);
    flags = fakeFlags();
    expect((await call(space, "GET", `/v1/import/batches/${batchId}`)).json().state).toBe("uploaded");
  });
});

describe("IMP-01@PoC FR 13: a full batch never grows (issue 582)", () => {
  it("IMP-01@PoC FR 13: uploads to a batch of 50 files are each refused with the ceiling (413), never a 500, and add no row", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    const fifty = Array.from({ length: 50 }, (_, i) => ({
      name: `s${i}.csv`,
      bytes: csv([["d", String(i)]]),
    }));
    expect((await upload(space, batchId, fifty)).statusCode).toBe(201);
    for (let i = 0; i < 3; i += 1) {
      const res = await upload(space, batchId, [
        { name: "x.csv", bytes: STATEMENT },
        { name: "m.xls", bytes: MACROS() },
      ]);
      expect(res.statusCode, res.body).toBe(413);
      expect(res.json().rejection).toMatchObject({ code: "BATCH_TOO_MANY_FILES" });
    }
    const { rows } = await db.owner.query<{ c: number; p: number }>(
      `SELECT count(*)::int AS c, max(position)::int AS p FROM import_sessions.batch_files WHERE batch_id = $1`,
      [batchId],
    );
    expect(rows[0]).toEqual({ c: 50, p: 50 });
    expect(objectsOf(space.householdId)).toHaveLength(50);
  });

  it("IMP-01@PoC FR 13: the 50 files count rejected ones too; a file past them is answered without a row (no id or position)", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    const parts = [
      { name: "m.xls", bytes: MACROS() },
      ...Array.from({ length: 48 }, (_, i) => ({ name: `s${i}.csv`, bytes: csv([["d", String(i)]]) })),
    ];
    expect((await upload(space, batchId, parts)).statusCode).toBe(201);
    const res = await upload(space, batchId, [
      { name: "last.csv", bytes: STATEMENT },
      { name: "over.csv", bytes: TSV },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    const [last, over] = res.json().files;
    expect(last).toMatchObject({ status: "accepted", position: 50 });
    expect(over).toMatchObject({
      id: null,
      position: null,
      createdAt: null,
      fileName: "over.csv",
      status: "rejected",
      rejectionCode: "BATCH_TOO_MANY_FILES",
      rejection: { code: "BATCH_TOO_MANY_FILES", ceiling: { name: "batchFiles", limit: 50 } },
    });
    expect(res.json().batch.files).toEqual({ accepted: 49, rejected: 1 });
    expect(await n("import_sessions.batch_files WHERE batch_id = $1", batchId)).toBe(50);
    expect(objectsOf(space.householdId)).toHaveLength(49);
  });
});
