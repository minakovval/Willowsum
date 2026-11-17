// Security review of PR #496 (IMP-01@PoC a, file-storage): tenant isolation of file_storage.files in the database,
// ciphertexts that cannot be moved between files or spaces, and download headers for hostile file names.
import { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import {
  memoryObjectStorage,
  type MemoryObjectStorage,
} from "../src/platform/adapters/object-storage/index.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import {
  createHouseholdSpaces,
  createSpaceKeys,
  type HouseholdSpaces,
} from "../src/modules/household/index.ts";
import {
  createFileStorage,
  FileNotFoundError,
  linkKey,
  SPACE_LIMITS_LOCK,
  uploadBudget,
  type FileStorage,
} from "../src/modules/file-storage/index.ts";
import { csv } from "../src/modules/file-storage/synthetic-files.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let objects: MemoryObjectStorage;
let files: FileStorage;
const actorId = randomUUID();
const newSpace = async () =>
  (await spaces.ensureFirstSpace({ accountId: randomUUID(), displayName: "Синтетична Особа" })).householdId;
const store = (householdId: string, bytes: Buffer, fileName = "statement.csv") =>
  files.store({
    householdId,
    actorId,
    kind: "statement",
    fileName,
    budget: uploadBudget(bytes.length),
    body: Readable.from([bytes]),
  });
const other = () =>
  csv([
    ["Дата", "Сума"],
    ["2026-01-01", String(randomBytes(4).readUInt32LE(0))],
  ]);

beforeAll(async () => {
  db = await setupRealModules(4);
  const kms = localKeyManagement();
  const audit = createAuditLog(db.databases.for("audit"));
  spaces = createHouseholdSpaces(db.databases.for("household"), audit, kms);
  objects = memoryObjectStorage();
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

describe("sec496: file_storage.files is isolated by the database (ARC-03 FR 2)", () => {
  it("row-level security is on and forced; the module's role sees and writes only the bound space", async () => {
    const { rows: flags } = await db.owner.query(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'file_storage' AND c.relname = 'files'`,
    );
    expect(flags).toEqual([{ rls: true, forced: true }]);
    const a = await newSpace();
    const b = await newSpace();
    const inA = await store(a, csv());
    const inB = await store(b, other());
    const module = db.databases.for("file-storage");
    // No WHERE on the space: only the policy stands between the query and the other space's row.
    const seen = await module.inHousehold(a, (q) => q.query<{ id: string }>("SELECT id FROM files"));
    expect(seen.rows.map((r) => r.id)).toEqual([inA.id]);
    const stolen = await module.inHousehold(a, (q) =>
      q.query("UPDATE files SET file_name = 'x' WHERE id = $1", [inB.id]),
    );
    expect(stolen.rowCount).toBe(0);
    const gone = await module.inHousehold(a, (q) => q.query("DELETE FROM files WHERE id = $1", [inB.id]));
    expect(gone.rowCount).toBe(0);
    await expect(
      module.inHousehold(a, (q) =>
        q.query(
          `INSERT INTO files (household_id, id, kind, format, content_type, file_name, size_bytes, sha256, object_key)
           SELECT $1, gen_random_uuid(), kind, format, content_type, file_name, size_bytes, sha256, 'spaces/x/files/y'
             FROM files LIMIT 1`,
          [b],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(files.find(a, inB.id)).rejects.toBeInstanceOf(FileNotFoundError);
    await expect(files.remove(a, inB.id, actorId)).rejects.toBeInstanceOf(FileNotFoundError);
    expect(await files.usage(a)).toBe(inA.sizeBytes);
    expect(objects.objects.has(inB.objectKey)).toBe(true);
  });
});

describe("sec496: the space's limits lock is really taken (NFR-15@PoC FR 31)", () => {
  it("while another transaction holds the lock of the space, nothing of an upload is written; it is stored once the lock is free", async () => {
    const a = await newSpace();
    const lock = [SPACE_LIMITS_LOCK, a];
    await db.owner.query("SELECT pg_advisory_lock(hashtextextended($1 || $2::text, 0))", lock);
    let settled = false;
    const upload = store(a, csv()).finally(() => (settled = true));
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(settled).toBe(false);
      expect([...objects.objects.keys()].filter((k) => k.includes(a))).toEqual([]);
    } finally {
      await db.owner.query("SELECT pg_advisory_unlock(hashtextextended($1 || $2::text, 0))", lock);
    }
    const stored = await upload;
    expect(objects.objects.has(stored.objectKey)).toBe(true);
    // Another space is not held up by this space's lock.
    const b = await newSpace();
    await db.owner.query("SELECT pg_advisory_lock(hashtextextended($1 || $2::text, 0))", lock);
    try {
      await expect(store(b, csv())).resolves.toMatchObject({ householdId: b });
    } finally {
      await db.owner.query("SELECT pg_advisory_unlock(hashtextextended($1 || $2::text, 0))", lock);
    }
  });
});

describe("sec496: a ciphertext opens only as its own file of its own space (NFR-01@PoC FR 4)", () => {
  it("an object moved under another file's key, in the same space or another one, is not served", async () => {
    const a = await newSpace();
    const b = await newSpace();
    const first = await store(a, csv());
    const second = await store(a, other());
    const foreign = await store(b, other());
    const sealed = objects.objects.get(first.objectKey)!;
    await objects.put(second.objectKey, sealed);
    await objects.put(foreign.objectKey, sealed);
    await expect(files.open(a, (await files.link(a, second.id)).token)).rejects.toThrow();
    await expect(files.open(b, (await files.link(b, foreign.id)).token)).rejects.toThrow();
    // A flipped bit and a cut tail are refused too (AEAD), and two seals of one plaintext differ (fresh nonce).
    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 1]! ^= 1;
    await objects.put(first.objectKey, flipped);
    await expect(files.open(a, (await files.link(a, first.id)).token)).rejects.toThrow();
    await objects.put(first.objectKey, sealed.subarray(0, sealed.length - 1));
    await expect(files.open(a, (await files.link(a, first.id)).token)).rejects.toThrow();
    const again = await store(a, csv());
    const twin = objects.objects.get(again.objectKey)!;
    expect(twin.subarray(1, 13).equals(sealed.subarray(1, 13))).toBe(false);
    expect(twin.subarray(29).equals(sealed.subarray(29))).toBe(false);
  });

  it("a link of one file does not open another file of the same space", async () => {
    const a = await newSpace();
    const first = await store(a, csv());
    const second = await store(a, other());
    const { token } = await files.link(a, first.id);
    const [v, , expires, sig] = token.split(".");
    await expect(files.open(a, [v, second.id, expires, sig].join("."))).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
    await expect(files.link(a, first.id, 15 * 60 * 1000 + 1)).rejects.toThrow();
  });
});

describe("sec496: the download headers of a hostile file name (ARC-06@PoC FR 4)", () => {
  it("quotes, line breaks, paths and bidi marks in a name cannot add a header or a second file name", async () => {
    const a = await newSpace();
    const name = '..\\..\\x/зв\u202eіт".html\r\nSet-Cookie: a=b; filename="evil.html';
    const stored = await store(a, csv(), name);
    const { headers } = await files.open(a, (await files.link(a, stored.id)).token);
    const disposition = headers["content-disposition"]!;
    expect(disposition).not.toMatch(/[\r\n\u202e]/);
    expect(disposition.match(/filename="/g)).toHaveLength(1);
    expect(disposition).toMatch(
      /^attachment; filename="[^"\\;]*"; filename\*=UTF-8''[A-Za-z0-9%._~!'()*-]+$/,
    );
    expect(headers["content-type"]).toBe("text/csv");
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });

  it("a name with a lone surrogate is stored and can still be downloaded", async () => {
    const a = await newSpace();
    const stored = await store(a, csv(), "звіт\ud800.csv");
    await expect(files.open(a, (await files.link(a, stored.id)).token)).resolves.toMatchObject({
      status: 200,
    });
  });
});
