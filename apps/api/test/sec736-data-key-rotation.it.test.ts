import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NUMBER_FIELD } from "../src/modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import {
  createHouseholdSpaces,
  createSpaceKeys,
  RotationTargetError,
  type SpaceKeys,
} from "../src/modules/household/index.ts";
import { ACCOUNT_VALUE_FIELD } from "../src/modules/import-recipes/index.ts";
import { parsePurpose } from "../src/modules/import-sessions/application/parse.ts";
import {
  fileKeyManagement,
  fixedLabelSource,
  isFixedLabelVersion,
  localKeyManagement,
  type KeyManagement,
  type LocalKeyManagement,
} from "../src/platform/adapters/kms/index.ts";
import { directoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { modulePasswordVariable } from "../src/platform/config/config.ts";
import type { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { sealedColumnsPart, type ResealPart } from "../src/platform/modules/reseal.ts";
import { KMS_ROTATE_BUSY, KMS_ROTATE_LOCK, resealParts } from "../scripts/lib/kms-rotate-data-keys.ts";
import { leakText } from "./leak-text.ts";
import {
  apiDir,
  migrateRealModules,
  openRealModules,
  realModules,
  createRealModulesDatabase,
} from "./real-modules.ts";

/**
 * Security review of #736 (NFR-01@PoC FR 3): the properties of the data-key rotation the PR's own suite does not pin —
 * the target key, stops at the last steps, a key destroyed while the run is in a part, other spaces untouched byte for
 * byte, every seal/open entry refusing during a rotation, and the output of a failed run. Synthetic values only.
 */
const password = randomBytes(12).toString("hex");
const tmp = mkdtempSync(path.join(os.tmpdir(), "ws-sec736-"));
const keyFile = path.join(tmp, "installation", "local-kms-key.json");
const filesDir = path.join(tmp, "files");
const objects = directoryObjectStorage(filesDir);

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;
let installation: LocalKeyManagement;
const legacy = localKeyManagement();
const source = { kms: fixedLabelSource(), owns: isFixedLabelVersion };

interface Sealed {
  readonly read: () => Promise<string | Buffer>;
  readonly plain: string;
  readonly open: (keys: SpaceKeys, stored: string | Buffer) => Promise<string>;
}
const seeded = new Map<string, Sealed[]>();
const accountIds = new Map<string, string[]>();

const auditLog = (): AuditLog => createAuditLog(databases.for("audit"));
const keysWith = (kms: KeyManagement, audit: AuditLog = auditLog()): SpaceKeys =>
  createSpaceKeys(databases.for("household"), audit, kms);
const synthetic = (label: string) => `SYNTH-${label}-${randomBytes(6).toString("hex")}`;
const parts = (): ResealPart[] => resealParts(databases, objects);
const rotate = (keys: SpaceKeys, p: readonly ResealPart[] = parts(), batchSize = 2) =>
  keys.rotateDataKeys({ source, parts: p, dryRun: false, batchSize });

async function column(table: string, col: string, where: string, args: unknown[]): Promise<string | Buffer> {
  const { rows } = await owner.query<Record<string, string | Buffer>>(
    `SELECT ${col} AS value FROM ${table} WHERE ${where}`,
    args,
  );
  return rows[0]!["value"]!;
}

async function makeSpace(kms: KeyManagement): Promise<string> {
  const { householdId } = await createHouseholdSpaces(
    databases.for("household"),
    auditLog(),
    kms,
  ).ensureFirstSpace({ accountId: randomUUID(), displayName: "Синтетичний Простір" });
  const keys = keysWith(kms);
  const values: Sealed[] = [];
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const id = randomUUID();
    ids.push(id);
    const plain = synthetic(`acct${i}`);
    await owner.query(
      `INSERT INTO accounts.accounts (household_id, id, kind, name, institution_key, number_last4, number_sealed,
         opened_on) VALUES ($1, $2, 'current', 'Synthetic', 'synthetic', 'AAAA', $3, '2026-01-01')`,
      [householdId, id, await keys.seal(householdId, NUMBER_FIELD, plain)],
    );
    values.push({
      read: () =>
        column("accounts.accounts", "number_sealed", "household_id = $1 AND id = $2", [householdId, id]),
      plain,
      open: (k, s) => k.open(householdId, NUMBER_FIELD, s as string),
    });
  }
  accountIds.set(householdId, ids);
  const recipeId = randomUUID();
  const [recipeValue, versionValue] = [synthetic("recipe"), synthetic("version")];
  await owner.query(
    `INSERT INTO import_recipes.recipes (household_id, id, name, schema_version, recipe, account_value_sealed,
       account_value_last4, created_by) VALUES ($1, $2, 'Synthetic', 1, '{}'::jsonb, $3, 'AAAA', $4)`,
    [householdId, recipeId, await keys.seal(householdId, ACCOUNT_VALUE_FIELD, recipeValue), randomUUID()],
  );
  await owner.query(
    `INSERT INTO import_recipes.recipe_versions (household_id, recipe_id, version, name, schema_version, recipe,
       account_value_sealed, account_value_last4, saved_by, saved_at)
     VALUES ($1, $2, 1, 'Synthetic', 1, '{}'::jsonb, $3, 'AAAA', $4, now())`,
    [householdId, recipeId, await keys.seal(householdId, ACCOUNT_VALUE_FIELD, versionValue), randomUUID()],
  );
  values.push(
    {
      read: () =>
        column("import_recipes.recipes", "account_value_sealed", "household_id = $1 AND id = $2", [
          householdId,
          recipeId,
        ]),
      plain: recipeValue,
      open: (k, s) => k.open(householdId, ACCOUNT_VALUE_FIELD, s as string),
    },
    {
      read: () =>
        column(
          "import_recipes.recipe_versions",
          "account_value_sealed",
          "household_id = $1 AND recipe_id = $2",
          [householdId, recipeId],
        ),
      plain: versionValue,
      open: (k, s) => k.open(householdId, ACCOUNT_VALUE_FIELD, s as string),
    },
  );
  const [batchFileId, parseId] = [randomUUID(), randomUUID()];
  const rows = synthetic("parse");
  const purpose = parsePurpose(batchFileId, parseId);
  await owner.query("BEGIN");
  await owner.query("SET LOCAL session_replication_role = replica");
  await owner.query(
    `INSERT INTO import_sessions.file_parses (household_id, batch_file_id, batch_id, parse_id, state, engine_version,
       rows_sealed, row_count, requested_by, requested_at, parsed_at)
     VALUES ($1, $2, $3, $4, 'parsed', '1', $5, 1, $6, now(), now())`,
    [
      householdId,
      batchFileId,
      randomUUID(),
      parseId,
      await keys.sealBytes(householdId, purpose, Buffer.from(rows, "utf8")),
      randomUUID(),
    ],
  );
  await owner.query("COMMIT");
  values.push({
    read: () =>
      column("import_sessions.file_parses", "rows_sealed", "household_id = $1 AND batch_file_id = $2", [
        householdId,
        batchFileId,
      ]),
    plain: rows,
    open: async (k, s) => (await k.openBytes(householdId, purpose, s as Buffer)).toString("utf8"),
  });
  const fileId = randomUUID();
  const objectKey = `spaces/${householdId}/files/${fileId}`;
  const fileText = synthetic("file");
  await owner.query(
    `INSERT INTO file_storage.files (household_id, id, kind, format, content_type, file_name, size_bytes, sha256,
       object_key) VALUES ($1, $2, 'statement', 'csv', 'text/csv', 'synthetic.csv', $3, $4, $5)`,
    [householdId, fileId, fileText.length, randomBytes(32), objectKey],
  );
  await objects.put(
    objectKey,
    await keys.sealBytes(householdId, `file:${fileId}`, Buffer.from(fileText, "utf8")),
  );
  values.push({
    read: async () => (await objects.get(objectKey))!,
    plain: fileText,
    open: async (k, s) => (await k.openBytes(householdId, `file:${fileId}`, s as Buffer)).toString("utf8"),
  });
  seeded.set(householdId, values);
  return householdId;
}

const asText = (s: string | Buffer) => (typeof s === "string" ? s : s.toString("base64"));
const snapshot = async (h: string) => Promise.all(seeded.get(h)!.map(async (v) => asText(await v.read())));

async function keyRow(h: string) {
  const { rows } = await owner.query<{ key_id: string; wrapped_key: string; exposed: boolean }>(
    "SELECT key_id, wrapped_key, exposed FROM household.space_keys WHERE household_id = $1",
    [h],
  );
  return rows[0];
}
async function rotationRow(h: string) {
  const { rows } = await owner.query<{ new_key_id: string; done_parts: string[] }>(
    "SELECT new_key_id, done_parts FROM household.space_key_rotations WHERE household_id = $1",
    [h],
  );
  return rows[0];
}
async function allOpen(h: string): Promise<void> {
  const keys = keysWith(installation);
  for (const v of seeded.get(h)!) expect(await v.open(keys, await v.read())).toBe(v.plain);
}

beforeAll(async () => {
  db = await createRealModulesDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  databases = await openRealModules(owner, db.url, 2, password);
  installation = fileKeyManagement({ file: keyFile });
}, 120_000);

afterAll(async () => {
  await databases?.end();
  await owner?.end();
  await db?.drop();
  rmSync(tmp, { recursive: true, force: true });
});

describe("NFR-01@PoC FR 3 (security review of #736): the data-key rotation", () => {
  it("NFR-01@PoC FR 3: a rotation whose target is the fixed-label key is refused and changes nothing", async () => {
    const h = await makeSpace(legacy);
    const before = await snapshot(h);
    const key = await keyRow(h);
    await expect(rotate(keysWith(legacy))).rejects.toBeInstanceOf(RotationTargetError);
    expect(await snapshot(h)).toEqual(before);
    expect(await keyRow(h)).toEqual(key);
    expect(await rotationRow(h)).toBeUndefined();
    expect(await rotate(keysWith(installation))).toMatchObject({ rotated: 1, failed: 0 });
    await allOpen(h);
  });

  it("NFR-01@PoC FR 3: a stop after the last batch of the last part, before it is marked done, loses nothing; the repeat seals nothing twice", async () => {
    const h = await makeSpace(legacy);
    const stopping = parts().map((part, i, all) =>
      i !== all.length - 1
        ? part
        : {
            ...part,
            reseal: async (...args: Parameters<ResealPart["reseal"]>) => {
              await part.reseal(...args);
              throw new Error("stopped");
            },
          },
    );
    const oldKey = await keyRow(h);
    expect(await rotate(keysWith(installation), stopping)).toMatchObject({ rotated: 0, failed: 1 });
    // Every value is under the new key already; the old key is still the space's key (not retired).
    expect(await keyRow(h)).toEqual(oldKey);
    expect((await rotationRow(h))!.done_parts).toEqual(["accounts", "import-recipes", "import-sessions"]);
    const sealedOnce = await snapshot(h);
    expect(await rotate(keysWith(installation))).toEqual({ found: 1, rotated: 1, failed: 0, values: 0 });
    expect(await snapshot(h)).toEqual(sealedOnce);
    await allOpen(h);
  });

  it("NFR-01@PoC FR 3: a stop after every part is done, before the keys are swapped, keeps the old key and the lock; the repeat finishes", async () => {
    const h = await makeSpace(legacy);
    const audit = auditLog();
    const failing: AuditLog = {
      ...audit,
      record: (householdId, entry) =>
        entry.entity.type === "household.space-key"
          ? Promise.reject(new Error("stopped"))
          : audit.record(householdId, entry),
    };
    const oldKey = await keyRow(h);
    expect(await rotate(keysWith(installation, failing))).toMatchObject({ rotated: 0, failed: 1 });
    expect(await keyRow(h)).toEqual(oldKey);
    expect((await rotationRow(h))!.done_parts).toHaveLength(4);
    await expect(keysWith(installation).seal(h, NUMBER_FIELD, synthetic("new"))).rejects.toMatchObject({
      code: "SPACE_KEY_ROTATING",
    });
    expect(await rotate(keysWith(installation))).toEqual({ found: 1, rotated: 1, failed: 0, values: 0 });
    expect((await keyRow(h))!.key_id).not.toBe(oldKey!.key_id);
    expect(await rotationRow(h)).toBeUndefined();
    await allOpen(h);
  });

  it("NFR-01@PoC FR 3, ARC-06 FR 5: a key destroyed while the run is inside a part stays destroyed — no key, no replacement, nothing opens", async () => {
    const h = await makeSpace(legacy);
    const keys = keysWith(installation);
    const destroying = parts().map((part) =>
      part.name !== "import-recipes"
        ? part
        : {
            ...part,
            reseal: async (...args: Parameters<ResealPart["reseal"]>) => {
              if (args[0] === h) expect(await keysWith(installation).destroy(h)).toEqual({ destroyed: true });
              return part.reseal(...args);
            },
          },
    );
    expect(await rotate(keys, destroying)).toMatchObject({ rotated: 0, failed: 1 });
    expect(await keyRow(h)).toBeUndefined();
    expect(await rotationRow(h)).toBeUndefined();
    const ref = await owner.query<{ ref: string }>(
      "SELECT encryption_key_ref AS ref FROM household.households WHERE household_id = $1",
      [h],
    );
    expect(ref.rows[0]!.ref).toMatch(/^destroyed:/);
    const first = seeded.get(h)![0]!;
    await expect(first.open(keys, await first.read())).rejects.toMatchObject({ code: "SPACE_KEY_DESTROYED" });
    expect(await rotate(keys)).toEqual({ found: 0, rotated: 0, failed: 0, values: 0 });
    expect(await keyRow(h)).toBeUndefined();
  });

  it("NFR-01@PoC FR 3, ARC-03: the rotation of one space leaves every stored value and the key of the other spaces byte for byte", async () => {
    const safe = await makeSpace(installation);
    const exposed = await makeSpace(legacy);
    const [before, key] = [await snapshot(safe), await keyRow(safe)];
    const beforeExposed = await snapshot(exposed);
    expect(await rotate(keysWith(installation))).toEqual({
      found: 1,
      rotated: 1,
      failed: 0,
      values: seeded.get(exposed)!.length,
    });
    expect(await snapshot(safe)).toEqual(before);
    expect(await keyRow(safe)).toEqual(key);
    const after = await snapshot(exposed);
    for (const [i, v] of after.entries()) expect(v).not.toBe(beforeExposed[i]);
    await allOpen(safe);
    await allOpen(exposed);
  });

  it("NFR-01@PoC FR 3: during a rotation every entry to the space's key refuses — seal, open, bytes and the worker's field opener", async () => {
    const h = await makeSpace(legacy);
    const stop = parts().map((part) => ({ ...part, reseal: () => Promise.reject(new Error("stopped")) }));
    expect(await rotate(keysWith(installation), stop)).toMatchObject({ failed: 1 });
    const keys = keysWith(installation);
    const [field, , , bytes] = [seeded.get(h)![0]!, 0, 0, seeded.get(h)![3]!];
    const rotating = { code: "SPACE_KEY_ROTATING" };
    await expect(keys.seal(h, NUMBER_FIELD, synthetic("x"))).rejects.toMatchObject(rotating);
    await expect(field.open(keys, await field.read())).rejects.toMatchObject(rotating);
    await expect(keys.sealBytes(h, `file:${randomUUID()}`, Buffer.from("x"))).rejects.toMatchObject(rotating);
    await expect(bytes.open(keys, await bytes.read())).rejects.toMatchObject(rotating);
    await expect(keys.fieldOpener(h, ACCOUNT_VALUE_FIELD)).rejects.toMatchObject(rotating);
    expect(await rotate(keys)).toMatchObject({ rotated: 1, failed: 0 });
    await allOpen(h);
  });

  it("NFR-01@PoC FR 3: a run that cannot finish a space prints counts only and exits 1 — no value, id, key or wrap", async () => {
    const h = await makeSpace(legacy);
    const [first, second] = accountIds.get(h)!;
    // One value that neither key opens: another row's sealed value (well-formed, sealed for the same field).
    const other = await makeSpace(legacy);
    const foreign = await seeded.get(other)![0]!.read();
    const sorted = [first!, second!].sort();
    await owner.query("UPDATE accounts.accounts SET number_sealed = $3 WHERE household_id = $1 AND id = $2", [
      h,
      sorted[1],
      foreign,
    ]);
    const u = new URL(db.url);
    const child = spawn(process.execPath, ["scripts/kms-rotate-data-keys.ts", "--batch-size", "1"], {
      cwd: apiDir,
      env: {
        PATH: process.env["PATH"] ?? "",
        WS_DB_HOST: u.hostname,
        WS_DB_PORT: u.port || "5432",
        WS_DB_NAME: u.pathname.slice(1),
        WS_DB_SSL: "false",
        WS_DB_PROBE_PASSWORD: password,
        WS_DB_CONTEXT_PASSWORD: password,
        ...Object.fromEntries(realModules.map((m) => [modulePasswordVariable(m), password])),
        WS_REAL_DATA: "true",
        WS_KMS_KEY_FILE: keyFile,
        WS_FILES_DIR: filesDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout!.on("data", (d) => (out += d));
    child.stderr!.on("data", (d) => (out += d));
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    expect(code).toBe(1);
    expect(out).toContain("1 space(s) not finished");
    // Review round 1: the module and the count of the value neither key opens are named — nothing else of it.
    expect(out).toContain("(accounts: 1)");
    const text = leakText(out);
    const { rows } = await owner.query<{ wrapped_key: string; household_id: string; key_id: string }>(
      `SELECT wrapped_key, household_id::text, key_id::text FROM household.space_keys
       UNION ALL SELECT new_wrapped_key, household_id::text, new_key_id::text FROM household.space_key_rotations`,
    );
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) for (const s of Object.values(r)) expect(text).not.toContain(s);
    for (const values of seeded.values()) for (const v of values) expect(text).not.toContain(v.plain);
    expect(text).not.toContain(password);
    expect(text).not.toContain(asText(foreign));
    for (const id of accountIds.get(h)!) expect(text).not.toContain(id);
    // Review round 1: the value neither key opens is found before anything is written — the space's replacement
    // never began, so it is not left locked (it keeps its old key and works as before).
    expect(await rotationRow(h)).toBeUndefined();
  });
});

describe("NFR-01@PoC FR 3 (security review of #736): follow-up probes", () => {
  // Follow-up 1, fixed in review round 1: every value is opened before the first write.
  it("NFR-01@PoC FR 3: a value neither key opens stops the replacement before it begins — the space stays usable", async () => {
    const h = await makeSpace(legacy);
    const other = await makeSpace(legacy);
    const last = [...accountIds.get(h)!].sort().at(-1)!;
    await owner.query("UPDATE accounts.accounts SET number_sealed = $3 WHERE household_id = $1 AND id = $2", [
      h,
      last,
      await seeded.get(other)![0]!.read(),
    ]);
    const keys = keysWith(installation);
    const result = await rotate(keys, parts(), 1);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    // The space is not left locked for good by one bad value: nothing began, every other value still opens.
    expect(await rotationRow(h)).toBeUndefined();
    const first = [...accountIds.get(h)!].sort()[0]!;
    const i = accountIds.get(h)!.indexOf(first);
    const v = seeded.get(h)![i]!;
    expect(await v.open(keysWith(legacy), await v.read())).toBe(v.plain);
  });
});

describe("NFR-01@PoC FR 3 (review round 1 of #736): the way out of an unfinished replacement", () => {
  it("NFR-01@PoC FR 3: a dry run names the module and count of a value neither key opens, and changes nothing", async () => {
    const h = await makeSpace(legacy);
    const other = await makeSpace(legacy);
    const last = [...accountIds.get(h)!].sort().at(-1)!;
    await owner.query("UPDATE accounts.accounts SET number_sealed = $3 WHERE household_id = $1 AND id = $2", [
      h,
      last,
      await seeded.get(other)![0]!.read(),
    ]);
    const before = await snapshot(h);
    const key = await keyRow(h);
    const result = await keysWith(installation).rotateDataKeys({
      source,
      parts: parts(),
      dryRun: true,
      batchSize: 1,
    });
    expect(result.unopenable).toMatchObject({ accounts: expect.any(Number) as number });
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await snapshot(h)).toEqual(before);
    expect(await keyRow(h)).toEqual(key);
    expect(await rotationRow(h)).toBeUndefined();
  });

  it("NFR-01@PoC FR 3: --abort after a stop in the middle of a batch seals every value back with the old key and discards the new key", async () => {
    const h = await makeSpace(legacy);
    let calls = 0;
    const stopping = parts().map((part) =>
      part.name !== "accounts"
        ? part
        : {
            ...part,
            reseal: (householdId: string, resealer: Parameters<ResealPart["reseal"]>[1], batchSize: number) =>
              part.reseal(
                householdId,
                {
                  field: (field, sealed) => {
                    if (householdId === h && ++calls === 3) throw new Error("stopped");
                    return resealer.field(field, sealed);
                  },
                  bytes: (purpose, sealed) => resealer.bytes(purpose, sealed),
                },
                batchSize,
              ),
          },
    );
    const oldKey = await keyRow(h);
    await rotate(keysWith(installation), stopping, 2);
    const rotation = await rotationRow(h);
    expect(rotation).toBeDefined();
    const legacyKeys = keysWith(legacy);
    await expect(legacyKeys.seal(h, NUMBER_FIELD, synthetic("x"))).rejects.toMatchObject({
      code: "SPACE_KEY_ROTATING",
    });
    const aborted = await keysWith(installation).abortDataKeyRotations({
      source,
      parts: parts(),
      batchSize: 1,
    });
    expect(aborted).toMatchObject({ failed: 0 });
    expect(aborted.aborted).toBe(aborted.found);
    expect(aborted.values).toBeGreaterThanOrEqual(1);
    expect(await rotationRow(h)).toBeUndefined();
    // The old key stays the space's key (still to be replaced); every value opens with it again and seal works.
    expect(await keyRow(h)).toEqual(oldKey);
    for (const v of seeded.get(h)!) expect(await v.open(legacyKeys, await v.read())).toBe(v.plain);
    await expect(legacyKeys.seal(h, NUMBER_FIELD, synthetic("y"))).resolves.toEqual(expect.any(String));
    const { rows } = await owner.query<{ action: string }>(
      `SELECT action FROM audit.entries WHERE household_id = $1 AND entity_type = 'household.space-key'
         AND entity_id = $2`,
      [h, rotation!.new_key_id],
    );
    expect(rows.map((r) => r.action)).toContain("delete");
    // A later run replaces the key after all.
    await rotate(keysWith(installation));
    expect(await rotationRow(h)).toBeUndefined();
    expect((await keyRow(h))!.key_id).not.toBe(oldKey!.key_id);
    await allOpen(h);
  });
});

describe("NFR-01@PoC FR 3 (security review round 2 of #736): --abort", () => {
  const abort = (
    keys: SpaceKeys = keysWith(installation),
    p: readonly ResealPart[] = parts(),
    batchSize = 1,
  ) => keys.abortDataKeyRotations({ source, parts: p, batchSize });
  const stopAt = (name: string) =>
    parts().map((part) =>
      part.name !== name ? part : { ...part, reseal: () => Promise.reject(new Error("stopped")) },
    );

  it("NFR-01@PoC FR 3: --abort after the keys are swapped changes nothing — the new key and every value stay", async () => {
    const h = await makeSpace(legacy);
    await rotate(keysWith(installation));
    expect(await rotationRow(h)).toBeUndefined();
    const [before, key] = [await snapshot(h), await keyRow(h)];
    await abort();
    expect(await snapshot(h)).toEqual(before);
    expect(await keyRow(h)).toEqual(key);
    await allOpen(h);
  });

  it("NFR-01@PoC FR 3: --abort after two parts finished brings every value back under the old key; a repeat changes nothing", async () => {
    const h = await makeSpace(legacy);
    const oldKey = await keyRow(h);
    await rotate(keysWith(installation), stopAt("import-sessions"));
    expect((await rotationRow(h))!.done_parts).toEqual(["accounts", "import-recipes"]);
    const r = await abort();
    expect(r.aborted).toBeGreaterThanOrEqual(1);
    expect(await rotationRow(h)).toBeUndefined();
    expect(await keyRow(h)).toEqual(oldKey);
    const legacyKeys = keysWith(legacy);
    for (const v of seeded.get(h)!) expect(await v.open(legacyKeys, await v.read())).toBe(v.plain);
    const once = await snapshot(h);
    await abort();
    expect(await snapshot(h)).toEqual(once);
    expect(await keyRow(h)).toEqual(oldKey);
  });

  it("NFR-01@PoC FR 3: an --abort stopped in the middle is finished by a repeat", async () => {
    const h = await makeSpace(legacy);
    const oldKey = await keyRow(h);
    expect(await rotate(keysWith(installation), stopAt("file-storage"))).toMatchObject({ rotated: 0 });
    const first = await abort(keysWith(installation), stopAt("import-recipes"));
    expect(first.failed).toBeGreaterThanOrEqual(1);
    expect(await rotationRow(h)).toBeDefined();
    await abort();
    expect(await rotationRow(h)).toBeUndefined();
    expect(await keyRow(h)).toEqual(oldKey);
    const legacyKeys = keysWith(legacy);
    for (const v of seeded.get(h)!) expect(await v.open(legacyKeys, await v.read())).toBe(v.plain);
  });

  it("NFR-01@PoC FR 3, ARC-03: --abort leaves the values and keys of the other spaces byte for byte", async () => {
    const safe = await makeSpace(installation);
    const exposedIdle = await makeSpace(legacy);
    const h = await makeSpace(legacy);
    // Only h is stopped mid-replacement; exposedIdle is first replaced fully.
    const onlyH = parts().map((part) =>
      part.name !== "import-recipes"
        ? part
        : {
            ...part,
            reseal: (householdId: string, ...rest: [Parameters<ResealPart["reseal"]>[1], number]) =>
              householdId === h ? Promise.reject(new Error("stopped")) : part.reseal(householdId, ...rest),
          },
    );
    await rotate(keysWith(installation), onlyH);
    expect(await rotationRow(h)).toBeDefined();
    const snaps = [await snapshot(safe), await snapshot(exposedIdle)];
    const keysBefore = [await keyRow(safe), await keyRow(exposedIdle)];
    await abort();
    expect([await snapshot(safe), await snapshot(exposedIdle)]).toEqual(snaps);
    expect([await keyRow(safe), await keyRow(exposedIdle)]).toEqual(keysBefore);
    await allOpen(safe);
    await allOpen(exposedIdle);
  });

  it("NFR-01@PoC FR 3: --abort leaves a value neither key opens as it is and counts it", async () => {
    const h = await makeSpace(legacy);
    const other = await makeSpace(installation);
    await rotate(keysWith(installation), stopAt("import-sessions"));
    expect(await rotationRow(h)).toBeDefined();
    const last = [...accountIds.get(h)!].sort().at(-1)!;
    await owner.query("UPDATE accounts.accounts SET number_sealed = $3 WHERE household_id = $1 AND id = $2", [
      h,
      last,
      await seeded.get(other)![0]!.read(),
    ]);
    const r = await abort();
    expect(r.unopenable).toBeGreaterThanOrEqual(1);
    expect(await rotationRow(h)).toBeUndefined();
  });
});

describe("NFR-01@PoC FR 3 (security review round 2 of #736): one run at a time", () => {
  const runCommand = async (args: string[]) => {
    const u = new URL(db.url);
    const child = spawn(process.execPath, ["scripts/kms-rotate-data-keys.ts", ...args], {
      cwd: apiDir,
      env: {
        PATH: process.env["PATH"] ?? "",
        WS_DB_HOST: u.hostname,
        WS_DB_PORT: u.port || "5432",
        WS_DB_NAME: u.pathname.slice(1),
        WS_DB_SSL: "false",
        WS_DB_PROBE_PASSWORD: password,
        WS_DB_CONTEXT_PASSWORD: password,
        ...Object.fromEntries(realModules.map((m) => [modulePasswordVariable(m), password])),
        WS_REAL_DATA: "true",
        WS_KMS_KEY_FILE: keyFile,
        WS_FILES_DIR: filesDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout!.on("data", (d) => (out += d));
    child.stderr!.on("data", (d) => (out += d));
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    return { code, out };
  };

  it("NFR-01@PoC FR 3: while another run holds the database, --abort and a replacement are refused and change nothing", async () => {
    const h = await makeSpace(legacy);
    const stop = parts().map((part) => ({ ...part, reseal: () => Promise.reject(new Error("stopped")) }));
    await rotate(keysWith(installation), stop);
    const [before, key, rotation] = [await snapshot(h), await keyRow(h), await rotationRow(h)];
    expect(rotation).toBeDefined();
    const holder = new pg.Client({ connectionString: db.url });
    await holder.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext($1))", [KMS_ROTATE_LOCK]);
      for (const args of [["--abort"], []]) {
        const { code, out } = await runCommand(args);
        expect(code).toBe(2);
        expect(out).toContain(KMS_ROTATE_BUSY);
      }
      expect(await snapshot(h)).toEqual(before);
      expect(await keyRow(h)).toEqual(key);
      expect(await rotationRow(h)).toEqual(rotation);
    } finally {
      await holder.end();
    }
    // The lock goes with the session: the next run goes ahead.
    const { code } = await runCommand(["--abort"]);
    expect(code).toBe(0);
    expect(await rotationRow(h)).toBeUndefined();
  });
});

describe("NFR-01@PoC FR 3 (security review round 2 of #736): guards of the abort and the parts", () => {
  it("NFR-01@PoC FR 3: an abort does not discard a replacement begun after its own pass (it refuses, the new one stays)", async () => {
    const h = await makeSpace(legacy);
    const stopLast = () =>
      parts().map((part) =>
        part.name !== "file-storage" ? part : { ...part, reseal: () => Promise.reject(new Error("stopped")) },
      );
    await rotate(keysWith(installation), stopLast());
    let second: { new_key_id: string } | undefined;
    const racing = parts().map((part) =>
      part.name !== "file-storage"
        ? part
        : {
            ...part,
            reseal: async (
              householdId: string,
              resealer: Parameters<ResealPart["reseal"]>[1],
              batchSize: number,
            ) => {
              if (householdId === h && !second) {
                // Meanwhile: the first replacement is undone and a new one begins and seals three parts.
                await keysWith(installation).abortDataKeyRotations({ source, parts: parts(), batchSize: 1 });
                await rotate(keysWith(installation), stopLast());
                second = await rotationRow(h);
              }
              return part.reseal(householdId, resealer, batchSize);
            },
          },
    );
    await keysWith(installation).abortDataKeyRotations({ source, parts: racing, batchSize: 1 });
    expect(second).toBeDefined();
    expect((await rotationRow(h))?.new_key_id).toBe(second!.new_key_id);
    expect(await rotate(keysWith(installation))).toMatchObject({ rotated: expect.any(Number) as number });
    expect(await rotationRow(h)).toBeUndefined();
    await allOpen(h);
  });

  it("NFR-01@PoC FR 3, ARC-03: a sealed column whose statements are not bound to the space or do not lock is refused", () => {
    const ok = {
      keys: ["id"],
      column: "v",
      select: "SELECT id, v FROM t WHERE household_id = $1 AND id > $2 ORDER BY id LIMIT $3 FOR UPDATE",
      update: "UPDATE t SET v = $3 WHERE household_id = $1 AND id = $2",
      count: "SELECT count(*)::text AS n FROM t WHERE household_id = $1",
      sealedFor: { kind: "field", field: "f" },
    } as const;
    const db = { inHousehold: () => Promise.reject(new Error("unused")) };
    expect(() => sealedColumnsPart("p", db, [ok])).not.toThrow();
    for (const bad of [
      { ...ok, select: ok.select.replace("household_id = $1 AND ", "") },
      { ...ok, update: "UPDATE t SET v = $3 WHERE id = $2" },
      { ...ok, count: "SELECT count(*)::text AS n FROM t" },
      { ...ok, select: ok.select.replace(" FOR UPDATE", "") },
      { ...ok, keys: [] },
    ])
      expect(() => sealedColumnsPart("p", db, [bad])).toThrow(/bound to the space/);
  });
});
