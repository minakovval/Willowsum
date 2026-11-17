import { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { localKeyManagement } from "../../platform/adapters/kms/index.ts";
import {
  ensureBucket,
  s3ObjectStorage,
  type ObjectStorage,
  type S3Options,
} from "../../platform/adapters/object-storage/index.ts";
import { createAuditLog } from "../audit/index.ts";
import { createHouseholdSpaces, createSpaceKeys, type HouseholdSpaces } from "../household/index.ts";
import { createFileStorage, FileRejectedError, linkKey, uploadBudget, type FileStorage } from "./index.ts";
import { acceptedFiles, rejectedFiles } from "./synthetic-cases.ts";
import { csv } from "./synthetic-files.ts";

/**
 * ARC-06@PoC FR 4 on a local S3-compatible storage (SeaweedFS, the image of infra/local/compose.yaml) and a real
 * PostgreSQL: the bucket refuses anonymous requests, only allowed types become objects, and a stored file is served
 * through a signed link as a download. CI part `checks` of the job `api` (`pnpm test:s3`). Synthetic files only.
 */
function s3Options(): S3Options {
  const need = (name: string) => {
    const value = process.env[name];
    if (!value)
      throw new Error(
        `${name} is not set: start the local S3 storage (pnpm local:up) or see vitest.s3.config.ts`,
      );
    return value;
  };
  return {
    endpoint: need("WS_TEST_S3_ENDPOINT"),
    region: "us-east-1",
    bucket: `ws-test-${randomBytes(6).toString("hex")}`,
    accessKeyId: need("WS_TEST_S3_ACCESS_KEY"),
    secretAccessKey: need("WS_TEST_S3_SECRET_KEY"),
  };
}

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let options: S3Options;
let objects: ObjectStorage;
let files: FileStorage;
const actorId = randomUUID();

beforeAll(async () => {
  options = s3Options();
  await ensureBucket(options);
  objects = s3ObjectStorage(options);
  db = await setupRealModules(4);
  const kms = localKeyManagement();
  const audit = createAuditLog(db.databases.for("audit"));
  spaces = createHouseholdSpaces(db.databases.for("household"), audit, kms);
  files = createFileStorage({
    db: db.databases.for("file-storage"),
    audit,
    keys: createSpaceKeys(db.databases.for("household"), audit, kms),
    objects,
    linkKey: linkKey(randomBytes(32)),
  });
});

afterAll(async () => {
  await db?.close();
});

async function newSpace(): Promise<string> {
  return (await spaces.ensureFirstSpace({ accountId: randomUUID(), displayName: "Тарас Сховищенко" }))
    .householdId;
}

function store(householdId: string, bytes: Buffer, fileName: string, declared = bytes.length) {
  return files.store({
    householdId,
    actorId,
    kind: "statement",
    fileName,
    budget: uploadBudget(declared),
    body: Readable.from([bytes]),
  });
}

async function rows(householdId: string): Promise<number> {
  const { rows: r } = await db.owner.query(
    "SELECT count(*)::int AS n FROM file_storage.files WHERE household_id = $1",
    [householdId],
  );
  return (r[0] as { n: number }).n;
}

describe("S3-compatible storage (ARC-06@PoC FR 4)", () => {
  it("ARC-06@PoC FR 4, criterion «Файл, доступний без підписаного посилання»: anonymous requests for the list and an object are refused", async () => {
    const householdId = await newSpace();
    const stored = await store(householdId, csv(), "statement.csv");
    expect(await objects.list(`spaces/${householdId}/`)).toEqual([stored.objectKey]);
    const base = `${new URL(options.endpoint).origin}/${options.bucket}`;
    for (const url of [base, `${base}?list-type=2`, `${base}/${stored.objectKey}`]) {
      const res = await fetch(url);
      await res.body?.cancel();
      expect([401, 403], url).toContain(res.status);
    }
    const head = await fetch(`${base}/${stored.objectKey}`, { method: "HEAD" });
    expect([401, 403]).toContain(head.status);
  });

  it("ARC-06@PoC FR 4, criterion «Файл недозволеного типу у сховищі»: refused files leave no object and no row; CSV, TSV, XLSX and XLS become encrypted objects", async () => {
    const householdId = await newSpace();
    for (const { label, bytes, fileName, declared, code } of rejectedFiles()) {
      const err = await store(householdId, bytes, fileName, declared).catch((e: unknown) => e);
      expect(err, label).toBeInstanceOf(FileRejectedError);
      expect((err as FileRejectedError).code, label).toBe(code);
    }
    expect(await objects.list(`spaces/${householdId}/`)).toEqual([]);
    expect(await rows(householdId)).toBe(0);
    for (const { format, bytes, fileName } of acceptedFiles()) {
      const stored = await store(householdId, bytes, fileName);
      expect(stored.format).toBe(format);
      const object = await objects.get(stored.objectKey);
      expect(object!.includes(bytes.subarray(0, 16))).toBe(false);
    }
    expect(await objects.list(`spaces/${householdId}/`)).toHaveLength(4);
    expect(await rows(householdId)).toBe(4);
  });

  it("ARC-06@PoC FR 4, criterion «Віддача файлу»: a signed link serves the original as a download with its content type and nosniff", async () => {
    const householdId = await newSpace();
    const stored = await store(householdId, csv(), "statement.xls");
    const download = await files.open(householdId, (await files.link(householdId, stored.id)).token);
    expect(download.body).toEqual(csv());
    expect(download.headers).toMatchObject({
      "content-type": "text/csv",
      "x-content-type-options": "nosniff",
    });
    expect(download.headers["content-disposition"]).toMatch(/^attachment;/);
    await files.remove(householdId, stored.id, actorId);
    expect(await objects.get(stored.objectKey)).toBeNull();
  });
});
