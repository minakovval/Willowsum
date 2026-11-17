import { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { localKeyManagement } from "../../platform/adapters/kms/index.ts";
import {
  memoryObjectStorage,
  type MemoryObjectStorage,
} from "../../platform/adapters/object-storage/index.ts";
import { createAuditLog } from "../audit/index.ts";
import {
  createHouseholdSpaces,
  createSpaceKeys,
  type HouseholdSpaces,
  type SpaceKeys,
} from "../household/index.ts";
import {
  createFileStorage,
  FileNotFoundError,
  FileRejectedError,
  linkKey,
  SIGNED_LINK_MAX_TTL_MS,
  uploadBudget,
  type FileStorage,
  type RejectionCode,
  type UploadBudget,
} from "./index.ts";
import { rejectedFiles, acceptedFiles } from "./synthetic-cases.ts";
import { csv, executable, xls, XLSM_MAIN, xlsx, zip } from "./synthetic-files.ts";

/**
 * file-storage on a real PostgreSQL with the test implementations of the object storage and the KMS ports
 * (ARC-06@PoC FR 4, NFR-01@PoC FR 4, NFR-15@PoC FR 18, FR 31). The S3 adapter's own criteria run against a local
 * S3-compatible storage in file-storage.s3.test.ts. Files and names are synthetic.
 */
let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let keys: SpaceKeys;
let objects: MemoryObjectStorage;
let clock: Date;
let files: FileStorage;
const actorId = randomUUID();

async function newSpace(): Promise<string> {
  return (await spaces.ensureFirstSpace({ accountId: randomUUID(), displayName: "Оксана Файлова" }))
    .householdId;
}

function body(bytes: Buffer) {
  return Readable.from([bytes]);
}

async function store(householdId: string, bytes: Buffer, fileName = "statement.csv", budget?: UploadBudget) {
  return files.store({
    householdId,
    actorId,
    kind: "statement",
    fileName,
    budget: budget ?? uploadBudget(bytes.length),
    body: body(bytes),
  });
}

async function rejection(work: Promise<unknown>): Promise<FileRejectedError> {
  const err = await work.catch((e: unknown) => e);
  if (!(err instanceof FileRejectedError)) throw new Error(`Expected a rejection, got ${String(err)}`);
  return err;
}

async function rows(householdId: string): Promise<number> {
  const { rows: r } = await db.owner.query(
    "SELECT count(*)::int AS n FROM file_storage.files WHERE household_id = $1",
    [householdId],
  );
  return (r[0] as { n: number }).n;
}

const objectsOf = (householdId: string) => [...objects.objects.keys()].filter((k) => k.includes(householdId));

beforeAll(async () => {
  db = await setupRealModules(4);
  const kms = localKeyManagement();
  const audit = createAuditLog(db.databases.for("audit"));
  spaces = createHouseholdSpaces(db.databases.for("household"), audit, kms);
  keys = createSpaceKeys(db.databases.for("household"), audit, kms);
  objects = memoryObjectStorage();
  clock = new Date("2026-11-17T10:00:00Z");
  files = createFileStorage({
    db: db.databases.for("file-storage"),
    audit,
    keys,
    objects,
    linkKey: linkKey(randomBytes(32)),
    now: () => clock,
  });
});

afterAll(async () => {
  await db?.close();
});

describe("only allowed types reach the storage (ARC-06@PoC FR 4, NFR-15@PoC FR 18)", () => {
  it("ARC-06@PoC FR 4, criterion «Файл недозволеного типу у сховищі»: every refused kind leaves no object and no row; CSV, TSV, XLSX and XLS are stored", async () => {
    const householdId = await newSpace();
    for (const { label, bytes, fileName, declared, code } of rejectedFiles()) {
      const budget = declared === undefined ? uploadBudget(bytes.length) : undefined;
      const err = await rejection(
        declared === undefined
          ? store(householdId, bytes, fileName, budget)
          : (async () => store(householdId, bytes, fileName, uploadBudget(declared)))(),
      );
      expect(err.code, label).toBe(code);
    }
    expect(objectsOf(householdId)).toEqual([]);
    expect(await rows(householdId)).toBe(0);
    for (const { format, bytes, fileName } of acceptedFiles()) {
      const stored = await store(householdId, bytes, fileName);
      expect(stored.format).toBe(format);
    }
    expect(objectsOf(householdId)).toHaveLength(4);
    expect(await rows(householdId)).toBe(4);
  }, 120_000);

  it("NFR-15@PoC AC6: a .csv that is a ZIP or an executable, an .xlsx that is XLSM and an XLS with macros are «Формат не підтримується»; the CSV, XLSX and XLS of the same request are accepted", async () => {
    const householdId = await newSpace();
    const request = [
      { name: "archive.csv", bytes: zip([{ name: "a.csv", data: csv() }]), ok: false },
      { name: "program.csv", bytes: executable(), ok: false },
      { name: "book.xlsx", bytes: xlsx({ main: XLSM_MAIN, vbaProject: true }), ok: false },
      {
        name: "macros.xls",
        bytes: xls({ extra: [{ name: "_VBA_PROJECT_CUR" }, { name: "VBA" }] }),
        ok: false,
      },
      { name: "statement.csv", bytes: csv(), ok: true },
      { name: "statement.xlsx", bytes: xlsx(), ok: true },
      { name: "statement.xls", bytes: xls(), ok: true },
    ];
    const budget = uploadBudget(request.reduce((n, f) => n + f.bytes.length, 0));
    const results: { name: string; code?: RejectionCode; message?: string; id?: string }[] = [];
    for (const file of request) {
      try {
        const stored = await store(householdId, file.bytes, file.name, budget);
        results.push({ name: file.name, id: stored.id });
      } catch (error) {
        if (!(error instanceof FileRejectedError)) throw error;
        results.push({ name: file.name, code: error.code, message: error.rejection.message.uk });
      }
    }
    for (const [i, file] of request.entries()) {
      if (file.ok) expect(results[i]!.id, file.name).toBeDefined();
      else
        expect(results[i], file.name).toMatchObject({
          code: "UNSUPPORTED_FORMAT",
          message: "Формат не підтримується",
        });
    }
    expect(objectsOf(householdId)).toHaveLength(3);
    expect(await rows(householdId)).toBe(3);
  });
});

describe("encryption with the space's key (ARC-06@PoC FR 4, NFR-01@PoC FR 4)", () => {
  it("NFR-01@PoC FR 4: the stored object is AES-256-GCM ciphertext bound to its space and file, never the plaintext", async () => {
    const householdId = await newSpace();
    const plain = csv();
    const stored = await store(householdId, plain);
    const object = objects.objects.get(stored.objectKey)!;
    expect(stored.objectKey).toBe(`spaces/${householdId}/files/${stored.id}`);
    expect(object.length).toBe(plain.length + 1 + 12 + 16);
    expect(object.includes(Buffer.from("Синтетика"))).toBe(false);
    expect(object.includes(plain.subarray(0, 16))).toBe(false);
    await expect(keys.openBytes(householdId, `file:${stored.id}`, object)).resolves.toEqual(plain);
    await expect(keys.openBytes(await newSpace(), `file:${stored.id}`, object)).rejects.toThrow();
    await expect(keys.openBytes(householdId, `file:${randomUUID()}`, object)).rejects.toThrow();
    expect(stored).toMatchObject({ sizeBytes: plain.length, format: "csv", contentType: "text/csv" });
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("downloads only through signed links (ARC-06@PoC FR 4, NFR-01@PoC FR 4)", () => {
  it("ARC-06@PoC FR 4, criterion «Віддача файлу»: the link answers with the type of the content, attachment and nosniff", async () => {
    const householdId = await newSpace();
    // A CSV named .xlsx: served by its content, as text/csv.
    const stored = await store(householdId, csv(), "виписка жовтень.xlsx");
    const { token, expiresAt } = await files.link(householdId, stored.id);
    expect(expiresAt.getTime() - clock.getTime()).toBeLessThanOrEqual(SIGNED_LINK_MAX_TTL_MS);
    const download = await files.open(householdId, token);
    expect(download.body).toEqual(csv());
    expect(download.headers["content-type"]).toBe("text/csv");
    expect(download.headers["content-disposition"]).toMatch(/^attachment; filename="/);
    expect(download.headers["content-disposition"]).toContain(encodeURIComponent("виписка жовтень.xlsx"));
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    const book = await store(householdId, xls(), "book.xls");
    const xlsDownload = await files.open(householdId, (await files.link(householdId, book.id)).token);
    expect(xlsDownload.headers["content-type"]).toBe("application/vnd.ms-excel");
  });

  it("NFR-01@PoC FR 4, criterion «Підписані посилання»: an expired, tampered or other space's link and a link to a removed file are «not found»", async () => {
    const householdId = await newSpace();
    const stranger = await newSpace();
    const stored = await store(householdId, csv());
    const { token } = await files.link(householdId, stored.id);
    await expect(files.open(stranger, token)).rejects.toBeInstanceOf(FileNotFoundError);
    await expect(files.link(stranger, stored.id)).rejects.toBeInstanceOf(FileNotFoundError);
    await expect(files.open(householdId, token.slice(0, -2) + "AA")).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
    const opened = clock;
    clock = new Date(opened.getTime() + SIGNED_LINK_MAX_TTL_MS);
    try {
      await expect(files.open(householdId, token)).rejects.toBeInstanceOf(FileNotFoundError);
    } finally {
      clock = opened;
    }
    await files.remove(householdId, stored.id, actorId);
    await expect(files.open(householdId, token)).rejects.toBeInstanceOf(FileNotFoundError);
    expect(objects.objects.has(stored.objectKey)).toBe(false);
    expect(await rows(householdId)).toBe(0);
  });

  it("ARC-06@PoC FR 4: storing and removing a file are audited by kind, format and size, never its name", async () => {
    const householdId = await newSpace();
    const stored = await store(householdId, csv(), "UA00 0000 0000 0000 0000 0000 0000 0.csv");
    await files.remove(householdId, stored.id, actorId);
    const { rows: entries } = await db.owner.query(
      `SELECT action, changes::text AS changes FROM audit.entries WHERE household_id = $1 AND entity_type = 'file-storage.file' ORDER BY occurred_at, action`,
      [householdId],
    );
    expect((entries as { action: string }[]).map((e) => e.action)).toEqual(["create", "delete"]);
    for (const e of entries as { changes: string }[]) {
      expect(e.changes).toContain("sizeBytes");
      expect(e.changes).not.toContain("UA00");
      expect(e.changes).not.toContain(".csv");
    }
  });
});

describe("the technical limit of a space's storage (NFR-15@PoC FR 31)", () => {
  it("NFR-15@PoC AC4: with 99.9 GB stored, a 200 MB upload is 413 «Досягнуто технічної межі сховища простору (100 ГБ)», nothing is stored, the plan does not change it", async () => {
    const householdId = await newSpace();
    const stored = await store(householdId, csv());
    // 99.9 GB of earlier files (one synthetic row standing for them).
    await db.owner.query(
      `UPDATE file_storage.files SET size_bytes = $2 WHERE household_id = $1 AND id = $3`,
      [householdId, Math.round(99.9 * 1024 ** 3), stored.id],
    );
    const before = objectsOf(householdId).length;
    const err = await rejection(
      files.store({
        householdId,
        actorId,
        kind: "statement",
        fileName: "big.csv",
        declaredBytes: 200 * 1024 * 1024,
        budget: { used: 0, read: () => Promise.reject(new Error("the stream must not be read")) },
        body: body(csv()),
      }),
    );
    expect(err.rejection).toMatchObject({
      code: "SPACE_STORAGE_LIMIT",
      status: 413,
      message: { uk: "Досягнуто технічної межі сховища простору (100 ГБ)" },
    });
    expect(objectsOf(householdId)).toHaveLength(before);
    expect(await rows(householdId)).toBe(1);
  });

  it("NFR-15@PoC FR 31, criterion «Технічна межа сховища»: the limit is checked under the space's lock — of two uploads that fit only one at a time, one is stored", async () => {
    const householdId = await newSpace();
    const small = createFileStorage({
      db: db.databases.for("file-storage"),
      audit: createAuditLog(db.databases.for("audit")),
      keys,
      objects,
      linkKey: linkKey(randomBytes(32)),
      spaceBytes: csv().length + 10,
    });
    const attempt = () =>
      small
        .store({
          householdId,
          actorId,
          kind: "statement",
          fileName: "a.csv",
          budget: uploadBudget(),
          body: body(csv()),
        })
        .then(
          () => "stored",
          (e: unknown) => (e instanceof FileRejectedError ? e.code : String(e)),
        );
    const results = await Promise.all([attempt(), attempt(), attempt()]);
    expect(results.filter((r) => r === "stored")).toHaveLength(1);
    expect(results.filter((r) => r === "SPACE_STORAGE_LIMIT")).toHaveLength(2);
    expect(await rows(householdId)).toBe(1);
    expect(objectsOf(householdId)).toHaveLength(1);
    expect(await small.usage(householdId)).toBe(csv().length);
  });

  it("NFR-15@PoC FR 31: the limit is 100 GiB for every file of the space", async () => {
    const { FILE_LIMITS } = await import("./index.ts");
    expect(FILE_LIMITS.spaceBytes).toBe(100 * 1024 ** 3);
  });
});
