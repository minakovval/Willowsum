import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NUMBER_FIELD } from "../src/modules/accounts/index.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import {
  createHouseholdSpaces,
  createSpaceKeys,
  SpaceKeyError,
  type SpaceKeys,
} from "../src/modules/household/index.ts";
import { ACCOUNT_VALUE_FIELD } from "../src/modules/import-recipes/index.ts";
import { parsePurpose } from "../src/modules/import-sessions/application/parse.ts";
import {
  fileKeyManagement,
  localKeyManagement,
  type KeyManagement,
  type LocalKeyManagement,
} from "../src/platform/adapters/kms/index.ts";
import { directoryObjectStorage } from "../src/platform/adapters/object-storage/index.ts";
import { modulePasswordVariable } from "../src/platform/config/config.ts";
import type { ModuleDatabases } from "../src/platform/db/module-db.ts";
import type { ResealPart } from "../src/platform/modules/reseal.ts";
import { runKmsRewrap } from "../scripts/lib/kms-rewrap.ts";
import {
  parseKmsRotateArgs,
  resealParts,
  runKmsRotateDataKeys,
} from "../scripts/lib/kms-rotate-data-keys.ts";
import { createTestDatabase } from "./db.ts";
import { leakText } from "./leak-text.ts";
import { apiDir, migrateRealModules, openRealModules, realModules } from "./real-modules.ts";

/**
 * NFR-01@PoC FR 3, NFR-15@PoC FR 26 (the security review of #726) on a real PostgreSQL (`pnpm db:test`): the data keys
 * of spaces made under the fixed-label test key are replaced, and every sealed value of such a space — account
 * numbers, the account binding of templates and their versions, parsed statements, stored files — is sealed again
 * with the new key, so a copy of the database made before (which the repository's key opens) opens none of it. The
 * run is resumable after a stop in the middle of a batch, never seals a value twice, leaves other spaces as they are
 * and prints counts only. Accounts are random ids; values are synthetic.
 */
const password = randomBytes(12).toString("hex");
const tmp = mkdtempSync(path.join(os.tmpdir(), "ws-kms-rotate-"));
const keyFile = path.join(tmp, "installation", "local-kms-key.json");
const filesDir = path.join(tmp, "files");
const objects = directoryObjectStorage(filesDir);
const ACCOUNTS_PER_SPACE = 5;
const BATCH = 2;

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;
let installation: LocalKeyManagement;
const legacy = localKeyManagement();

interface Sealed {
  readonly table: string;
  readonly where: string;
  readonly column: string;
  readonly plain: string;
  /** Opens the stored value through the space's keys. */
  readonly open: (keys: SpaceKeys, stored: string | Buffer) => Promise<string>;
}
/** Every sealed value of a space, by space. */
const seeded = new Map<string, Sealed[]>();

const keysWith = (kms: KeyManagement): SpaceKeys =>
  createSpaceKeys(databases.for("household"), createAuditLog(databases.for("audit")), kms);

const synthetic = (label: string) => `SYNTH-${label}-${randomBytes(6).toString("hex")}`;

async function makeSpace(kms: KeyManagement, name: string): Promise<string> {
  const { householdId } = await createHouseholdSpaces(
    databases.for("household"),
    createAuditLog(databases.for("audit")),
    kms,
  ).ensureFirstSpace({ accountId: randomUUID(), displayName: name });
  return householdId;
}

/** Sealed values in every part of the space, written as the modules store them (seeded as the database owner). */
async function seed(householdId: string, kms: KeyManagement): Promise<void> {
  const keys = keysWith(kms);
  const values: Sealed[] = [];
  for (let i = 0; i < ACCOUNTS_PER_SPACE; i++) {
    const id = randomUUID();
    const plain = synthetic(`acct${i}`);
    await owner.query(
      `INSERT INTO accounts.accounts (household_id, id, kind, name, institution_key, number_last4, number_sealed,
         opened_on) VALUES ($1, $2, 'current', 'Synthetic', 'synthetic', 'AAAA', $3, '2026-01-01')`,
      [householdId, id, await keys.seal(householdId, NUMBER_FIELD, plain)],
    );
    values.push({
      table: "accounts.accounts",
      where: `household_id = '${householdId}' AND id = '${id}'`,
      column: "number_sealed",
      plain,
      open: (k, s) => k.open(householdId, NUMBER_FIELD, s as string),
    });
  }
  const recipeId = randomUUID();
  const recipeValue = synthetic("recipe");
  const versionValue = synthetic("version");
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
      table: "import_recipes.recipes",
      where: `household_id = '${householdId}' AND id = '${recipeId}'`,
      column: "account_value_sealed",
      plain: recipeValue,
      open: (k, s) => k.open(householdId, ACCOUNT_VALUE_FIELD, s as string),
    },
    {
      table: "import_recipes.recipe_versions",
      where: `household_id = '${householdId}' AND recipe_id = '${recipeId}' AND version = 1`,
      column: "account_value_sealed",
      plain: versionValue,
      open: (k, s) => k.open(householdId, ACCOUNT_VALUE_FIELD, s as string),
    },
  );
  const [batchFileId, parseId] = [randomUUID(), randomUUID()];
  const rows = synthetic("parse");
  const purpose = parsePurpose(batchFileId, parseId);
  const rowsSealed = await keys.sealBytes(householdId, purpose, Buffer.from(rows, "utf8"));
  // The parse's batch is not seeded: its deferred key check is left out for this load (the owner's session only).
  await owner.query("BEGIN");
  await owner.query("SET LOCAL session_replication_role = replica");
  await owner.query(
    `INSERT INTO import_sessions.file_parses (household_id, batch_file_id, batch_id, parse_id, state, engine_version,
       rows_sealed, row_count, requested_by, requested_at, parsed_at)
     VALUES ($1, $2, $3, $4, 'parsed', '1', $5, 1, $6, now(), now())`,
    [householdId, batchFileId, randomUUID(), parseId, rowsSealed, randomUUID()],
  );
  await owner.query("COMMIT");
  values.push({
    table: "import_sessions.file_parses",
    where: `household_id = '${householdId}' AND batch_file_id = '${batchFileId}'`,
    column: "rows_sealed",
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
    table: "object",
    where: objectKey,
    column: "",
    plain: fileText,
    open: async (k, s) => (await k.openBytes(householdId, `file:${fileId}`, s as Buffer)).toString("utf8"),
  });
  seeded.set(householdId, values);
}

async function stored(v: Sealed): Promise<string | Buffer> {
  if (v.table === "object") return (await objects.get(v.where))!;
  const { rows } = await owner.query<Record<string, string | Buffer>>(
    `SELECT ${v.column} AS value FROM ${v.table} WHERE ${v.where}`,
  );
  return rows[0]!["value"]!;
}

const asText = (s: string | Buffer) => (typeof s === "string" ? s : s.toString("base64"));

async function snapshot(householdId: string): Promise<string[]> {
  return Promise.all(seeded.get(householdId)!.map(async (v) => asText(await stored(v))));
}

async function keyRow(householdId: string) {
  const { rows } = await owner.query<{
    key_id: string;
    master_key_version: string;
    wrapped_key: string;
    exposed: boolean;
  }>(
    "SELECT key_id, master_key_version, wrapped_key, exposed FROM household.space_keys WHERE household_id = $1",
    [householdId],
  );
  return rows[0];
}

async function rotations(): Promise<number> {
  const { rows } = await owner.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM household.space_key_rotations",
  );
  return Number(rows[0]!.n);
}

/** The parts, with one stop after `after` sealed values of the accounts part (a crash in the middle of a batch). */
function stoppingParts(after: number): ResealPart[] {
  let calls = 0;
  return resealParts(databases, objects).map((part) =>
    part.name !== "accounts"
      ? part
      : {
          ...part,
          reseal: (householdId, resealer, batchSize) =>
            part.reseal(
              householdId,
              {
                field: (field, sealed) => {
                  if (++calls === after + 1) throw new Error("stopped");
                  return resealer.field(field, sealed);
                },
                bytes: (purpose, sealed) => resealer.bytes(purpose, sealed),
              },
              batchSize,
            ),
        },
  );
}

function scriptEnv(): Record<string, string> {
  const u = new URL(db.url);
  return {
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
  };
}

function run(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, ["scripts/kms-rotate-data-keys.ts", ...args], {
    cwd: apiDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (out += d));
  return new Promise<{ code: number | null; out: string }>((resolve) =>
    child.on("exit", (code) => resolve({ code, out })),
  );
}

const command = { dryRun: false, batchSize: BATCH };
let rewrapped: string; // made under the fixed-label key, its wrap then moved to the key file (the re-wrap)
let stillFixed: string; // made under the fixed-label key, never re-wrapped
let fresh: string; // made under the installation's key: never exposed
const preRewrap = new Map<string, Awaited<ReturnType<typeof keyRow>>>();

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  databases = await openRealModules(owner, db.url, 2, password);
  installation = fileKeyManagement({ file: keyFile });
  rewrapped = await makeSpace(legacy, "Олена Перша");
  await seed(rewrapped, legacy);
  preRewrap.set(rewrapped, await keyRow(rewrapped));
  await runKmsRewrap(databases, installation, { dryRun: false });
  stillFixed = await makeSpace(legacy, "Богдан Другий");
  await seed(stillFixed, legacy);
  preRewrap.set(stillFixed, await keyRow(stillFixed));
  fresh = await makeSpace(installation, "Ірина Третя");
  await seed(fresh, installation);
}, 120_000);

afterAll(async () => {
  await databases?.end();
  await owner?.end();
  await db?.drop();
  rmSync(tmp, { recursive: true, force: true });
});

describe("NFR-01@PoC FR 3: replacing the data keys made under the fixed-label test key", () => {
  it("NFR-01@PoC FR 3: a key made under the fixed-label key is exposed, also after the re-wrap; one made under the key file is not", async () => {
    expect((await keyRow(rewrapped))!).toMatchObject({ master_key_version: "inst-1", exposed: true });
    expect((await keyRow(stillFixed))!).toMatchObject({ master_key_version: "local-1", exposed: true });
    expect((await keyRow(fresh))!).toMatchObject({ master_key_version: "inst-1", exposed: false });
  });

  it("NFR-01@PoC FR 3: the dry run counts the spaces and their sealed values and changes nothing", async () => {
    const before = await Promise.all([rewrapped, stillFixed, fresh].map(snapshot));
    const keysBefore = await Promise.all([rewrapped, stillFixed, fresh].map(keyRow));
    const perSpace = seeded.get(rewrapped)!.length;
    expect(
      await runKmsRotateDataKeys(databases, installation, resealParts(databases, objects), {
        ...command,
        dryRun: true,
      }),
    ).toEqual({ found: 2, rotated: 0, failed: 0, values: 2 * perSpace });
    expect(await Promise.all([rewrapped, stillFixed, fresh].map(snapshot))).toEqual(before);
    expect(await Promise.all([rewrapped, stillFixed, fresh].map(keyRow))).toEqual(keysBefore);
    expect(await rotations()).toBe(0);
  });

  it("NFR-01@PoC FR 3: a stop in the middle of a batch keeps what was done; the space refuses seal and open until the run is repeated", async () => {
    const before = new Map(
      await Promise.all([rewrapped, stillFixed].map(async (h) => [h, await snapshot(h)] as const)),
    );
    // The first space's accounts part stops on its third value: its first batch (2 values) is committed, the second
    // batch is rolled back. The other space then finishes.
    const result = await runKmsRotateDataKeys(databases, installation, stoppingParts(3), command);
    expect(result).toMatchObject({ found: 2, rotated: 1, failed: 1 });
    expect(await rotations()).toBe(1);
    const { rows } = await owner.query<{ household_id: string; done_parts: string[] }>(
      "SELECT household_id, done_parts FROM household.space_key_rotations",
    );
    const stopped = rows[0]!.household_id;
    expect(rows[0]!.done_parts).toEqual([]);
    const now = await snapshot(stopped);
    const changed = now.filter((v, i) => v !== before.get(stopped)![i]).length;
    expect(changed).toBe(BATCH);
    // NFR-01@PoC FR 3: while the replacement is unfinished nothing is sealed (it would be under the old key) or opened.
    const keys = keysWith(installation);
    await expect(keys.seal(stopped, NUMBER_FIELD, synthetic("new"))).rejects.toMatchObject({
      code: "SPACE_KEY_ROTATING",
    });
    const first = seeded.get(stopped)![0]!;
    await expect(first.open(keys, await stored(first))).rejects.toBeInstanceOf(SpaceKeyError);
  });

  it("NFR-01@PoC FR 3: the repeat carries on with the same new key; every value opens to what it was, sealed once", async () => {
    const { rows } = await owner.query<{ household_id: string; new_key_id: string }>(
      "SELECT household_id, new_key_id FROM household.space_key_rotations",
    );
    const [stopped, newKeyId] = [rows[0]!.household_id, rows[0]!.new_key_id];
    const result = await runKmsRotateDataKeys(
      databases,
      installation,
      resealParts(databases, objects),
      command,
    );
    // The two values sealed before the stop are left as they are: never sealed twice.
    expect(result).toEqual({ found: 1, rotated: 1, failed: 0, values: seeded.get(stopped)!.length - BATCH });
    expect(await rotations()).toBe(0);
    expect((await keyRow(stopped))!.key_id).toBe(newKeyId);
    const keys = keysWith(installation);
    for (const h of [rewrapped, stillFixed]) {
      const row = (await keyRow(h))!;
      expect(row).toMatchObject({ master_key_version: "inst-1", exposed: false });
      expect(row.key_id).not.toBe(preRewrap.get(h)!.key_id);
      const ref = await owner.query<{ ref: string }>(
        "SELECT encryption_key_ref AS ref FROM household.households WHERE household_id = $1",
        [h],
      );
      expect(ref.rows[0]!.ref).toBe(`dek:${row.key_id}`);
      for (const v of seeded.get(h)!) expect(await v.open(keys, await stored(v))).toBe(v.plain);
    }
  });

  it("NFR-01@PoC criterion «Шифрування при зберіганні»: a copy made before (the old key, which the repository opens) opens none of the new values", async () => {
    for (const h of [rewrapped, stillFixed]) {
      const now = (await keyRow(h))!;
      const old = preRewrap.get(h)!;
      // The copy made before the re-wrap: the old data key wrapped by the fixed-label key.
      await owner.query(
        `UPDATE household.space_keys SET key_id = $2, master_key_version = $3, wrapped_key = $4 WHERE household_id = $1`,
        [h, old!.key_id, old!.master_key_version, old!.wrapped_key],
      );
      try {
        for (const v of seeded.get(h)!)
          await expect(v.open(keysWith(legacy), await stored(v))).rejects.toMatchObject({
            code: "SEALED_VALUE_INVALID",
          });
      } finally {
        await owner.query(
          `UPDATE household.space_keys SET key_id = $2, master_key_version = $3, wrapped_key = $4 WHERE household_id = $1`,
          [h, now.key_id, now.master_key_version, now.wrapped_key],
        );
      }
    }
  });

  it("NFR-01@PoC FR 3: a space whose key was made under the key file is left as it is", async () => {
    const keys = keysWith(installation);
    const row = (await keyRow(fresh))!;
    expect(row.exposed).toBe(false);
    for (const v of seeded.get(fresh)!) expect(await v.open(keys, await stored(v))).toBe(v.plain);
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.entries WHERE household_id = $1 AND entity_type = 'household.space-key'
         AND action = 'delete'`,
      [fresh],
    );
    expect(rows[0]!.n).toBe("0");
  });

  it("NFR-01@PoC FR 3: each replacement is in the space's log — the new key made, the old one retired", async () => {
    for (const h of [rewrapped, stillFixed]) {
      const { rows } = await owner.query<{ entity_id: string; action: string }>(
        `SELECT entity_id::text, action FROM audit.entries WHERE household_id = $1 AND entity_type = 'household.space-key'
           AND action IN ('create', 'delete') ORDER BY occurred_at, action`,
        [h],
      );
      const now = (await keyRow(h))!;
      expect(rows).toContainEqual({ entity_id: now.key_id, action: "create" });
      expect(rows).toContainEqual({ entity_id: preRewrap.get(h)!.key_id, action: "delete" });
    }
  });

  it("NFR-01@PoC FR 3: a repeat finds nothing and changes nothing (idempotent)", async () => {
    const before = await Promise.all([rewrapped, stillFixed, fresh].map(snapshot));
    expect(
      await runKmsRotateDataKeys(databases, installation, resealParts(databases, objects), command),
    ).toEqual({ found: 0, rotated: 0, failed: 0, values: 0 });
    expect(await Promise.all([rewrapped, stillFixed, fresh].map(snapshot))).toEqual(before);
  });

  it("NFR-01@PoC FR 3: destroying a space's key during its replacement destroys the new key too", async () => {
    const h = await makeSpace(legacy, "Марко Четвертий");
    await seed(h, legacy);
    await runKmsRewrap(databases, installation, { dryRun: false });
    expect(await runKmsRotateDataKeys(databases, installation, stoppingParts(0), command)).toMatchObject({
      failed: 1,
    });
    expect(await rotations()).toBe(1);
    expect(await keysWith(installation).destroy(h)).toEqual({ destroyed: true });
    expect(await rotations()).toBe(0);
    expect(await keyRow(h)).toBeUndefined();
  });
});

describe("NFR-01@PoC FR 3: the command kms:rotate-data-keys", () => {
  it("NFR-01@PoC FR 3: the arguments — a dry run and a batch size, nothing else", () => {
    expect(parseKmsRotateArgs([])).toEqual({ dryRun: false, batchSize: 100 });
    expect(parseKmsRotateArgs(["--", "--dry-run", "--batch-size", "7"])).toEqual({
      dryRun: true,
      batchSize: 7,
    });
    expect(() => parseKmsRotateArgs(["--batch-size", "0"])).toThrow(/1–1000/);
    expect(() => parseKmsRotateArgs(["--batch-size", "5000"])).toThrow(/1–1000/);
    expect(() => parseKmsRotateArgs(["--force"])).toThrow(/unknown argument/);
  });

  it("NFR-01@PoC FR 3: refuses to run without the real-data mark or the key file", async () => {
    const env = scriptEnv();
    const noMark = await run([], { ...env, WS_REAL_DATA: "false" });
    expect(noMark.code).toBe(2);
    expect(noMark.out).toContain("WS_REAL_DATA=true");
    const noKeyFile = Object.fromEntries(Object.entries(env).filter(([k]) => k !== "WS_KMS_KEY_FILE"));
    const noKey = await run([], noKeyFile);
    expect(noKey.code).not.toBe(0);
    expect(noKey.out).toContain("WS_KMS_KEY_FILE");
  });

  it("NFR-01@PoC FR 3: dry run and run print counts only — no value, key, wrap, key file content or space id", async () => {
    const h = await makeSpace(legacy, "Пізній Простір");
    await seed(h, legacy);
    const dry = await run(["--dry-run"], scriptEnv());
    expect(dry.code).toBe(0);
    expect(dry.out).toContain(
      `Dry run: 1 space(s) to get a new data key, ${seeded.get(h)!.length} sealed value(s)`,
    );
    const real = await run(["--batch-size", "3"], scriptEnv());
    expect(real.code).toBe(0);
    expect(real.out).toContain("Replaced the data keys of 1 of 1 space(s)");
    expect(real.out).toContain("delete those copies");
    expect(JSON.parse(real.out.trim().split("\n").at(-1)!)).toEqual({
      dryRun: false,
      found: 1,
      rotated: 1,
      failed: 0,
      values: seeded.get(h)!.length,
    });
    for (const v of seeded.get(h)!)
      expect(await v.open(keysWith(installation), await stored(v))).toBe(v.plain);
    const keyB64 = (JSON.parse(readFileSync(keyFile, "utf8")) as { versions: Record<string, string> })
      .versions["inst-1"]!;
    const { rows } = await owner.query<{ wrapped_key: string; household_id: string; key_id: string }>(
      "SELECT wrapped_key, household_id, key_id FROM household.space_keys",
    );
    for (const out of [leakText(dry.out), leakText(real.out)]) {
      expect(out).not.toContain(keyB64);
      expect(out).not.toContain(password);
      for (const values of seeded.values()) for (const v of values) expect(out).not.toContain(v.plain);
      for (const r of rows) {
        expect(out).not.toContain(r.wrapped_key);
        expect(out).not.toContain(r.household_id);
        expect(out).not.toContain(r.key_id);
      }
    }
  });
});
