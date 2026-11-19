import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountApi } from "../src/api.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import {
  memoryObjectStorage,
  type MemoryObjectStorage,
} from "../src/platform/adapters/object-storage/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { schedulerDailyTasks } from "../src/wiring.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import { createFileStorage, linkKey, type FileStorage } from "../src/modules/file-storage/index.ts";
import { csv } from "../src/modules/file-storage/synthetic-files.ts";
import { STATEMENT_ROWS } from "../src/modules/file-storage/synthetic-files.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createImportSessionsServices } from "../src/modules/import-sessions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of PR #599 (survivors of the mutation run): tests the lifecycle file does not have.
 * Harness copied from test/imp01-import-batch-lifecycle.it.test.ts.
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
testTelemetryForFile();

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

async function batchIds(householdId: string): Promise<string[]> {
  const { rows } = await db.owner.query<{ id: string }>(
    `SELECT id FROM import_sessions.batches WHERE household_id = $1`,
    [householdId],
  );
  return rows.map((r) => r.id).sort();
}

const fileAudit = (householdId: string, actorKind: string) =>
  n(
    "audit.entries WHERE household_id = $1 AND entity_type = 'file-storage.file' AND action = 'delete' AND actor_kind = $2",
    householdId,
    actorKind,
  );

describe("IMP-01@PoC «Права доступу»: a scoped member who may write (security review of PR 599)", () => {
  it("IMP-01@PoC «Права доступу»: a scoped editor is refused on cancel and delete with the same answer for a known and an unknown batch, and the batch and its original stay", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    await upload(space, batchId, [{ name: "a.csv", bytes: STATEMENT }]);
    const scopedEditor = principalHeader({
      userId: space.accountId,
      householdId: space.householdId,
      role: "editor",
      scoped: true,
    });
    for (const [method, url] of [
      ["POST", `/v1/import/batches/${batchId}/cancel`],
      ["DELETE", `/v1/import/batches/${batchId}`],
    ] as const) {
      const res = await app.inject({ method, url, headers: { origin: WEB, ...scopedEditor } });
      // access-scope refuses first (a scoped member only reads, whatever the role): one answer for any id, known or not.
      expect(res.statusCode, res.body).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
      expect(Object.keys(res.json()).sort()).toEqual(PROBLEM_KEYS);
      const unknown = await app.inject({
        method,
        url: url.replace(batchId, randomUUID()),
        headers: { origin: WEB, ...scopedEditor },
      });
      expect([unknown.statusCode, unknown.json().code]).toEqual([403, "FORBIDDEN"]);
    }
    expect((await call(space, "GET", `/v1/import/batches/${batchId}`)).json()).toMatchObject({
      state: "uploaded",
      files: { accepted: 1 },
    });
    expect(objectsOf(space.householdId)).toHaveLength(1);
    expect(await batchAudit(space.householdId, "delete")).toBe(0);
  });
});

describe("IMP-01@PoC FR 12, EC4: an upload that loses the race (security review of PR 599)", () => {
  it("IMP-01@PoC FR 12, EC4: a batch deleted while its file is being stored — the upload is «not found» and its original is removed, row and object", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    const store = files.store.bind(files);
    vi.spyOn(files, "store").mockImplementationOnce(async (request) => {
      const stored = await store(request);
      // The original is stored (row and object); the deletion wins before the batch's lock is taken.
      expect(objectsOf(space.householdId)).toHaveLength(1);
      expect((await remove(space, batchId)).statusCode).toBe(200);
      return stored;
    });
    const up = await upload(space, batchId, [{ name: "a.csv", bytes: STATEMENT }]);
    expect(up.statusCode, up.body).toBe(404);
    expect(await batchIds(space.householdId)).toEqual([]);
    expect(await n("file_storage.files WHERE household_id = $1", space.householdId)).toBe(0);
    expect(objectsOf(space.householdId)).toHaveLength(0);
    // The loser's original is removed in the caller's name, never the system's.
    expect(await fileAudit(space.householdId, "user")).toBe(1);
    expect(await fileAudit(space.householdId, "system")).toBe(0);
  });

  it("IMP-01@PoC FR 12: a batch cancelled while its file is being stored — the upload is refused (409) and its original is removed", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    const store = files.store.bind(files);
    vi.spyOn(files, "store").mockImplementationOnce(async (request) => {
      const stored = await store(request);
      expect((await cancel(space, batchId)).statusCode).toBe(200);
      return stored;
    });
    const up = await upload(space, batchId, [{ name: "a.csv", bytes: STATEMENT }]);
    expect(up.statusCode, up.body).toBe(409);
    expect((await call(space, "GET", `/v1/import/batches/${batchId}`)).json()).toMatchObject({
      state: "cancelled",
      files: { accepted: 0, rejected: 0 },
    });
    expect(await n("file_storage.files WHERE household_id = $1", space.householdId)).toBe(0);
    expect(objectsOf(space.householdId)).toHaveLength(0);
  });
});

describe("IMP-01@PoC FR 21: who the entries of a deletion belong to (security review of PR 599)", () => {
  it("IMP-01@PoC FR 21: «Видалити» by a person writes the person's entries for the batch and for every original — none is the system's", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    await upload(space, batchId, [
      { name: "a.csv", bytes: STATEMENT },
      { name: "b.tsv", bytes: TSV },
    ]);
    expect((await remove(space, batchId)).statusCode).toBe(200);
    expect(await fileAudit(space.householdId, "user")).toBe(2);
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND entity_type = 'file-storage.file' AND action = 'delete' AND actor_id = $2 AND channel = 'web'",
        space.householdId,
        space.accountId,
      ),
    ).toBe(2);
    expect(
      await n(
        "audit.entries WHERE household_id = $1 AND (actor_kind = 'system' OR channel = 'system')",
        space.householdId,
      ),
    ).toBe(0);
  });
});

describe("IMP-01@PoC FR 20: the cleanup judges the last action under the batch's lock (security review of PR 599)", () => {
  it("IMP-01@PoC FR 20: a batch that gets an action after the cleanup listed it and before its lock stays, with its original", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    await upload(space, batchId, [{ name: "a.csv", bytes: STATEMENT }]);
    now += 31 * DAY;
    // Another transaction holds the batch's row: the cleanup lists the batch as stale, then waits for the lock.
    await db.owner.query("BEGIN");
    let running: Promise<unknown>;
    try {
      await db.owner.query("SELECT 1 FROM import_sessions.batches WHERE id = $1 FOR UPDATE", [batchId]);
      running = cleanup(space.householdId);
      for (let i = 0; i < 100; i += 1) {
        const { rows } = await db.owner.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND pid <> pg_backend_pid()",
        );
        if (rows[0]!.n > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // The action (an upload, a cancel) commits now, while the cleanup waits.
      await db.owner.query("UPDATE import_sessions.batches SET last_action_at = $2 WHERE id = $1", [
        batchId,
        new Date(now),
      ]);
      await db.owner.query("COMMIT");
    } catch (error) {
      await db.owner.query("ROLLBACK");
      throw error;
    }
    await running;
    expect(await batchIds(space.householdId)).toEqual([batchId]);
    expect(await n("import_sessions.batches WHERE id = $1 AND deleting_at IS NULL", batchId)).toBe(1);
    expect(objectsOf(space.householdId)).toHaveLength(1);
    expect(await batchAudit(space.householdId, "delete")).toBe(0);
  });
});

describe("ARC-03@PoC FR 2: the deletion mark stays inside the space (security review of PR 599)", () => {
  it("ARC-03@PoC FR 2: from another space's transaction a batch cannot be marked or dropped, even by a statement without the space", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const batchId = await newBatch(a);
    await upload(a, batchId, [{ name: "a.csv", bytes: STATEMENT }]);
    const changed = await db.databases.for("import-sessions").inHousehold(b.householdId, async (q) => {
      const seen = await q.query(
        "SELECT id FROM batches WHERE deleting_at IS NULL OR deleting_at IS NOT NULL",
      );
      const marked = await q.query("UPDATE batches SET deleting_at = now()");
      const dropped = await q.query("DELETE FROM batches WHERE id = $1", [batchId]);
      return [seen.rowCount, marked.rowCount, dropped.rowCount];
    });
    expect(changed).toEqual([0, 0, 0]);
    expect(await n("import_sessions.batches WHERE id = $1 AND deleting_at IS NULL", batchId)).toBe(1);
    expect((await call(a, "GET", `/v1/import/batches/${batchId}`)).statusCode).toBe(200);
  });
});

describe("IMP-01@PoC EC4: an original whose object could not be deleted (security review of PR 599, follow-up)", () => {
  // Documents the defect the PR lists under «Follow-ups»: file-storage removes the row first and the object after the
  // commit, so a failed object deletion leaves an encrypted object that no row names; the cleanup then drops the batch.
  it.fails(
    "IMP-01@PoC EC4: after a failed object deletion the next cleanup leaves no object of the deleted batch",
    async () => {
      const space = await newSpace();
      const batchId = await newBatch(space);
      await upload(space, batchId, [{ name: "a.csv", bytes: STATEMENT }]);
      vi.spyOn(objects, "delete").mockRejectedValueOnce(new Error("storage down"));
      expect((await remove(space, batchId)).statusCode).toBe(500);
      vi.restoreAllMocks();
      await cleanup(space.householdId);
      expect(await batchIds(space.householdId)).toEqual([]);
      expect(await n("file_storage.files WHERE household_id = $1", space.householdId)).toBe(0);
      expect(objectsOf(space.householdId)).toHaveLength(0);
    },
  );
});
