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
import { csv, xls, XLSM_MAIN, xlsx } from "../src/modules/file-storage/synthetic-files.ts";
import { STATEMENT_ROWS } from "../src/modules/file-storage/synthetic-files.ts";
import { createSpaceKeys, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { createImportSessionsServices } from "../src/modules/import-sessions/index.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * IMP-01@PoC b) (wave 2 row 39), the module `import-sessions` through the real API on a real PostgreSQL, with the test
 * object storage: batches, uploads of several files at once, originals in file-storage, signed links, the space's
 * boundary and the audit hand-off with its daily recovery (ARC-04, #249). «Скасувати», «Видалити» and the daily cleanup
 * after 30 days are part 2 of row 39; parsing the rows is row 40 (`file-parsers`). Every file and name is synthetic; the clock is the test's.
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

function call(space: Space, method: "GET" | "POST", url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: {
      origin: WEB,
      ...who(space),
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

describe("IMP-01@PoC: batches, uploads and originals", () => {
  it("IMP-01@PoC AC1, FR 1, FR 3, FR 7: CSV, TSV and XLSX uploaded at once make one batch of three files, each original stored", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space, "Жовтень");
    const res = await upload(space, batchId, [
      { name: "privat.csv", bytes: STATEMENT },
      { name: "mono.tsv", bytes: TSV },
      { name: "card.xlsx", bytes: xlsx() },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.batch).toMatchObject({ id: batchId, state: "uploaded", files: { accepted: 3, rejected: 0 } });
    expect(body.files.map((f: { format: string; status: string }) => [f.format, f.status])).toEqual([
      ["csv", "accepted"],
      ["tsv", "accepted"],
      ["xlsx", "accepted"],
    ]);
    expect(
      await n("file_storage.files WHERE household_id = $1 AND kind = 'statement'", space.householdId),
    ).toBe(3);
    expect(objectsOf(space.householdId)).toHaveLength(3);
    const list = await call(space, "GET", "/v1/import/batches");
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0]).toMatchObject({
      id: batchId,
      name: "Жовтень",
      files: { accepted: 3, rejected: 0 },
    });
  });

  it("IMP-01@PoC FR 7, AC3 (the original's part): an accepted file opens through a signed link of ≤ 15 min, only as a download", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    const fileId = (await upload(space, batchId, [{ name: "privat.csv", bytes: STATEMENT }])).json().files[0]
      .id;
    const link = await call(space, "POST", `/v1/import/batches/${batchId}/files/${fileId}/link`);
    expect(link.statusCode, link.body).toBe(200);
    expect(Date.parse(link.json().expiresAt) - now).toBeLessThanOrEqual(15 * 60 * 1000);
    const open = await call(space, "GET", `/v1/import/originals/${link.json().token}`);
    expect(open.statusCode).toBe(200);
    expect(open.rawPayload.equals(STATEMENT)).toBe(true);
    expect(open.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(open.headers["x-content-type-options"]).toBe("nosniff");
    expect(open.headers["cache-control"]).toBe("private, no-store");
    now += 15 * 60 * 1000 + 1;
    expect((await call(space, "GET", `/v1/import/originals/${link.json().token}`)).statusCode).toBe(404);
  });

  it("IMP-01@PoC AC12: an XLS with macros and an XLSM named .xlsx are rejected «Формат не підтримується» and not stored; the CSV is accepted", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    const res = await upload(space, batchId, [
      { name: "macros.xls", bytes: xls({ extra: [{ name: "_VBA_PROJECT_CUR" }] }) },
      { name: "book.xlsx", bytes: xlsx({ main: XLSM_MAIN, vbaProject: true }) },
      { name: "privat.csv", bytes: STATEMENT },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    const [a, b, c] = res.json().files;
    for (const f of [a, b]) {
      expect(f).toMatchObject({ status: "rejected", rejectionCode: "UNSUPPORTED_FORMAT", format: null });
      expect(f.rejection.message.uk).toBe("Формат не підтримується");
    }
    expect(c).toMatchObject({ status: "accepted", format: "csv", rejection: null });
    expect(await n("file_storage.files WHERE household_id = $1", space.householdId)).toBe(1);
    expect(objectsOf(space.householdId)).toHaveLength(1);
  });

  it("IMP-01@PoC FR 6, EC1, AC2: every file rejected — the first reason with its code, the batch «не вдалося розібрати»; the row ceiling's text advises splitting, no plan", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    const rows = [
      STATEMENT_ROWS[0]!,
      ...Array.from({ length: 25_000 }, (_, i) => ["2026-10-01", String(i), "x"]),
    ];
    const res = await upload(space, batchId, [
      { name: "big.csv", bytes: csv(rows) },
      { name: "macros.xls", bytes: xls({ extra: [{ name: "_VBA_PROJECT_CUR" }] }) },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.statusCode).not.toBe(402);
    expect(res.json()).toMatchObject({
      code: "FILE_REJECTED",
      rejection: { code: "TOO_MANY_ROWS", ceiling: { name: "rows", limit: 20_000 } },
    });
    expect(res.json().detail).toMatch(/20,000 rows.*Split the file/);
    expect(res.json().detail).not.toMatch(/plan/i);
    const batch = (await call(space, "GET", `/v1/import/batches/${batchId}`)).json();
    expect(batch).toMatchObject({ state: "failed", files: { accepted: 0, rejected: 2 } });
    expect(batch.fileList.map((f: { rejectionCode: string }) => f.rejectionCode)).toEqual([
      "TOO_MANY_ROWS",
      "UNSUPPORTED_FORMAT",
    ]);
    expect(objectsOf(space.householdId)).toHaveLength(0);
    // A failed batch takes no more files (FR 10): the step is refused (409).
    expect((await upload(space, batchId, [{ name: "a.csv", bytes: STATEMENT }])).json().code).toBe(
      "BATCH_STATE_CONFLICT",
    );
  });

  it("IMP-01@PoC FR 13: a batch holds up to 50 files; the 51st is rejected with the ceiling, not a plan (413)", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    const fifty = Array.from({ length: 50 }, (_, i) => ({
      name: `s${i}.csv`,
      bytes: csv([["d", String(i)]]),
    }));
    expect((await upload(space, batchId, fifty)).statusCode).toBe(201);
    const res = await upload(space, batchId, [{ name: "s51.csv", bytes: STATEMENT }]);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({
      code: "FILE_TOO_LARGE",
      rejection: { code: "BATCH_TOO_MANY_FILES", ceiling: { name: "batchFiles", limit: 50 } },
    });
    expect(await n("file_storage.files WHERE household_id = $1", space.householdId)).toBe(50);
  });

  it("IMP-01@PoC FR 13: a batch holds up to 150 MB of originals; a file past the batch's room is rejected with that ceiling (413)", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    // The batch already holds 150 MiB less 100 bytes of accepted originals (rows only: the ceiling counts their sizes).
    await db.owner.query(
      `INSERT INTO import_sessions.batch_files (household_id, id, batch_id, position, file_name, file_id, format, size_bytes)
       VALUES ($1, $2, $3, 1, 'held.csv', $4, 'csv', $5)`,
      [space.householdId, randomUUID(), batchId, randomUUID(), 150 * 1024 * 1024 - 100],
    );
    const res = await upload(space, batchId, [{ name: "a.csv", bytes: STATEMENT }]);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({
      code: "FILE_TOO_LARGE",
      rejection: { code: "BATCH_TOO_LARGE", ceiling: { name: "batchBytes", limit: 150 * 1024 * 1024 } },
    });
    expect(res.json().detail).toMatch(/150 MB.*Split/);
    expect(await n("file_storage.files WHERE household_id = $1", space.householdId)).toBe(0);
  });

  it("DS-12@PoC FR 11: a photo sent to the statement upload is rejected by its content and not stored", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    const png = Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), randomBytes(64)]);
    const jpeg = Buffer.concat([Buffer.from("ffd8ffe000104a464946", "hex"), randomBytes(64)]);
    const res = await upload(space, batchId, [
      { name: "photo.csv", bytes: png },
      { name: "photo.xlsx", bytes: jpeg },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("FILE_REJECTED");
    expect(await n("file_storage.files WHERE household_id = $1", space.householdId)).toBe(0);
    expect(objectsOf(space.householdId)).toHaveLength(0);
  });

  it("IMP-01@PoC FR 3: the upload route takes multipart only; JSON there and multipart elsewhere are 415", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    const json = await call(space, "POST", `/v1/import/batches/${batchId}/files`, { files: [] });
    expect(json.statusCode).toBe(415);
    const body = multipart([{ name: "a.csv", bytes: STATEMENT }]);
    const other = await app.inject({
      method: "POST",
      url: "/v1/import/batches",
      headers: { origin: WEB, ...who(space), "content-type": body.type },
      payload: body.payload,
    });
    expect(other.statusCode).toBe(415);
  });
});

describe("IMP-01@PoC «Права доступу»: another space gets «not found»", () => {
  it("IMP-01@PoC AC7, AC11: a batch, its files, its originals and their links are not found from another space", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const batchId = await newBatch(a);
    const fileId = (await upload(a, batchId, [{ name: "a.csv", bytes: STATEMENT }])).json().files[0].id;
    const token = (await call(a, "POST", `/v1/import/batches/${batchId}/files/${fileId}/link`)).json().token;
    const list = await call(b, "GET", "/v1/import/batches");
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ items: [], nextCursor: null });
    for (const res of [
      await call(b, "GET", `/v1/import/batches/${batchId}`),
      await upload(b, batchId, [{ name: "x.csv", bytes: STATEMENT }]),
      await call(b, "POST", `/v1/import/batches/${batchId}/files/${fileId}/link`),
      await call(b, "GET", `/v1/import/originals/${token}`),
    ]) {
      expect(res.statusCode).toBe(404);
      const problem = res.json();
      expect(problem.code).toBe("NOT_FOUND");
      expect(Object.keys(problem).sort()).toEqual(["code", "status", "supportId", "title", "type"]);
    }
    // Nothing of A changed, and B stored nothing.
    expect((await call(a, "GET", `/v1/import/batches/${batchId}`)).json()).toMatchObject({
      state: "uploaded",
      files: { accepted: 1, rejected: 0 },
    });
    expect(await n("file_storage.files WHERE household_id = $1", b.householdId)).toBe(0);
  });

  it("IMP-01@PoC «Права доступу»: a scoped member sees no batch; with the flag off the routes do not exist (404)", async () => {
    const space = await newSpace();
    await newBatch(space);
    const scoped = await app.inject({
      method: "GET",
      url: "/v1/import/batches",
      headers: { ...who(space, true) },
    });
    expect(scoped.statusCode).toBe(404);
    flags = fakeFlags({ off: ["data.import"] });
    expect((await call(space, "GET", "/v1/import/batches")).statusCode).toBe(404);
  });
});

describe("IMP-01@PoC FR 19, FR 21: the audit log and the logs", () => {
  it("IMP-01@PoC AC10, FR 19: no file content, IBAN or file name in the audit entries or the server log", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    const iban = "UA213223130000026007233566001";
    const rows = [
      ["Дата", "Сума", "Рахунок"],
      ["2026-10-01", "-120.50", iban],
    ];
    await upload(space, batchId, [
      { name: "secret-name.csv", bytes: csv(rows) },
      { name: "macros.xls", bytes: xls({ extra: [{ name: "_VBA_PROJECT_CUR" }] }) },
    ]);
    const { rows: entries } = await db.owner.query<{ changes: unknown }>(
      `SELECT changes FROM audit.entries WHERE household_id = $1`,
      [space.householdId],
    );
    const values = entries.flatMap((e) =>
      (e.changes as { before: string | null; after: string | null }[]).flatMap((c) => [c.before, c.after]),
    );
    for (const v of values) {
      expect(v === null || !v.includes(iban)).toBe(true);
      expect(v === null || !v.includes("secret-name")).toBe(true);
      expect(v === null || !v.includes("120.50")).toBe(true);
    }
    for (const record of telemetry.memory.logRecords()) {
      const text = [String(record.body), ...Object.values(record.attributes ?? {}).map(String)];
      for (const t of text) {
        expect(t.includes(iban)).toBe(false);
        expect(t.includes("secret-name")).toBe(false);
      }
    }
  });

  it("IMP-01@PoC FR 21: the batch's creation and each added file are audit entries", async () => {
    const space = await newSpace();
    const batchId = await newBatch(space);
    await upload(space, batchId, [
      { name: "a.csv", bytes: STATEMENT },
      { name: "b.tsv", bytes: TSV },
    ]);
    expect(await batchAudit(space.householdId, "create")).toBe(1);
    expect(await batchAudit(space.householdId, "update")).toBe(2);
  });

  it("ARC-04@PoC FR 4: an import-sessions audit job in state dead goes back to the queue with the daily recovery", async () => {
    const space = await newSpace();
    const original = audit.record.bind(audit);
    vi.spyOn(audit, "record").mockImplementation(async (householdId, entry) => {
      if (entry.entity.type === "import-sessions.batch") throw new Error("injected");
      return original(householdId, entry);
    });
    await newBatch(space);
    expect(await batchAudit(space.householdId, "create")).toBe(0);
    expect(telemetry.memory.logRecords().some((r) => r.body === "import_sessions.hand_off_deferred")).toBe(
      true,
    );
    vi.restoreAllMocks();
    await db.owner.query(
      `UPDATE import_sessions.jobs SET state = 'dead', attempts = 8 WHERE household_id = $1`,
      [space.householdId],
    );
    await runWorker(space.householdId);
    expect(await batchAudit(space.householdId, "create")).toBe(0);
    const tasks = schedulerDailyTasks({
      databases: db.databases,
      audit,
      spaces: { spaceIds: async () => [space.householdId], membershipOf: spaces.membershipOf },
      now: clock.now,
    });
    const names = tasks.map((t) => t.name);
    expect(names.indexOf("import-sessions.hand-off-recovery")).toBeLessThan(
      names.indexOf("queue.retention-cleanup"),
    );
    await tasks.find((t) => t.name === "import-sessions.hand-off-recovery")!.run();
    await runWorker(space.householdId);
    expect(
      await n("import_sessions.jobs WHERE household_id = $1 AND state = 'done'", space.householdId),
    ).toBe(1);
    expect(await batchAudit(space.householdId, "create")).toBe(1);
  });
});
