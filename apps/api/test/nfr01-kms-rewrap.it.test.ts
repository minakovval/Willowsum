import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { createHouseholdSpaces, createSpaceKeys, type SpaceKeys } from "../src/modules/household/index.ts";
import {
  fileKeyManagement,
  isFixedLabelVersion,
  localKeyManagement,
  type KeyManagement,
} from "../src/platform/adapters/kms/index.ts";
import { modulePasswordVariable } from "../src/platform/config/config.ts";
import type { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { runKmsRewrap } from "../scripts/lib/kms-rewrap.ts";
import {
  apiDir,
  migrateRealModules,
  openRealModules,
  realModules,
  createRealModulesDatabase,
} from "./real-modules.ts";

/**
 * NFR-01@PoC FR 3, NFR-15@PoC FR 26 (security review of #722) on a real PostgreSQL (`pnpm db:test`): the one-time
 * re-wrap moves every space key off the fixed-label test key to the installation's own key — idempotent, with a dry
 * run and a count report, never printing key material — and a real-data process does not start without its key file
 * or with one others may read. Accounts are random ids; values are synthetic.
 */
const password = randomBytes(12).toString("hex");
const keyDir = mkdtempSync(path.join(os.tmpdir(), "ws-kms-rewrap-"));
const keyFile = path.join(keyDir, "installation", "local-kms-key.json");
const IBAN = "UA00 0000 0000 0000 0000 0000 0000 0"; // synthetic: the format of an IBAN, no real account

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;
let installation: KeyManagement;
const sealed = new Map<string, string>();

const keysWith = (kms: KeyManagement): SpaceKeys =>
  createSpaceKeys(databases.for("household"), createAuditLog(databases.for("audit")), kms);

async function versions(): Promise<string[]> {
  const { rows } = await owner.query<{ v: string }>(
    "SELECT master_key_version AS v FROM household.space_keys ORDER BY 1",
  );
  return rows.map((r) => r.v);
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
  };
}

function without(env: Record<string, string>, ...names: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !names.includes(k)));
}

function run(file: string, args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, [file, ...args], {
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

beforeAll(async () => {
  db = await createRealModulesDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  databases = await openRealModules(owner, db.url, 2, password);
  // Spaces made before the installation had its key file: wrapped by the fixed-label test key.
  const legacy = localKeyManagement();
  const spaces = createHouseholdSpaces(
    databases.for("household"),
    createAuditLog(databases.for("audit")),
    legacy,
  );
  for (const name of ["Олена Перша", "Богдан Другий", "Ірина Третя"]) {
    const { householdId } = await spaces.ensureFirstSpace({ accountId: randomUUID(), displayName: name });
    sealed.set(householdId, await keysWith(legacy).seal(householdId, "iban", IBAN));
  }
  installation = fileKeyManagement({ file: keyFile });
}, 120_000);

afterAll(async () => {
  await databases?.end();
  await owner?.end();
  await db?.drop();
  rmSync(keyDir, { recursive: true, force: true });
});

describe("NFR-01@PoC FR 3: the one-time re-wrap off the fixed-label test key", () => {
  it("NFR-01@PoC FR 3: before the re-wrap the installation's key opens no old space key (the old wraps are the fixed-label ones)", async () => {
    expect((await versions()).every(isFixedLabelVersion)).toBe(true);
    const [householdId, value] = [...sealed][0]!;
    await expect(keysWith(installation).open(householdId, "iban", value)).rejects.toThrow();
  });

  it("NFR-01@PoC FR 3: the dry run counts the keys to move and changes nothing", async () => {
    const before = await owner.query(
      "SELECT key_id, master_key_version, wrapped_key FROM household.space_keys ORDER BY 1",
    );
    expect(await runKmsRewrap(databases, installation, { dryRun: true })).toEqual({
      found: 3,
      rewrapped: 0,
      failed: 0,
    });
    const after = await owner.query(
      "SELECT key_id, master_key_version, wrapped_key FROM household.space_keys ORDER BY 1",
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("NFR-01@PoC FR 3: the re-wrap moves every key to the installation's key; sealed values open; each move is in the space's log", async () => {
    expect(await runKmsRewrap(databases, installation, { dryRun: false })).toEqual({
      found: 3,
      rewrapped: 3,
      failed: 0,
    });
    expect(await versions()).toEqual(["inst-1", "inst-1", "inst-1"]);
    for (const [householdId, value] of sealed) {
      expect(await keysWith(installation).open(householdId, "iban", value)).toBe(IBAN);
      // A database copy together with the repository (the fixed-label key) opens nothing now.
      await expect(keysWith(localKeyManagement()).open(householdId, "iban", value)).rejects.toThrow();
    }
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.entries
        WHERE entity_type = 'household.space-key' AND action = 'update'`,
    );
    expect(Number(rows[0]!.n)).toBe(3);
  });

  it("NFR-01@PoC FR 3: a repeat finds nothing and changes nothing (idempotent)", async () => {
    const before = await owner.query("SELECT key_id, wrapped_key FROM household.space_keys ORDER BY 1");
    expect(await runKmsRewrap(databases, installation, { dryRun: false })).toEqual({
      found: 0,
      rewrapped: 0,
      failed: 0,
    });
    const after = await owner.query("SELECT key_id, wrapped_key FROM household.space_keys ORDER BY 1");
    expect(after.rows).toEqual(before.rows);
  });

  it("NFR-01@PoC FR 3: the command prints counts only — no key, wrap, key file content or space id", async () => {
    // One more old space, so the command has something to move.
    const legacy = localKeyManagement();
    const { householdId } = await createHouseholdSpaces(
      databases.for("household"),
      createAuditLog(databases.for("audit")),
      legacy,
    ).ensureFirstSpace({ accountId: randomUUID(), displayName: "Пізній Простір" });
    const dry = await run("scripts/kms-rewrap.ts", ["--dry-run"], scriptEnv());
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("Dry run: 1 space key(s)");
    const real = await run("scripts/kms-rewrap.ts", [], scriptEnv());
    expect(real.code).toBe(0);
    expect(real.out).toContain("Re-wrapped 1 of 1 space key(s)");
    expect(JSON.parse(real.out.trim().split("\n").at(-1)!)).toEqual({
      dryRun: false,
      found: 1,
      rewrapped: 1,
      failed: 0,
    });
    const fileText = readFileSync(keyFile, "utf8");
    const keyB64 = (JSON.parse(fileText) as { versions: Record<string, string> }).versions["inst-1"]!;
    const { rows } = await owner.query<{ wrapped_key: string; household_id: string; key_id: string }>(
      "SELECT wrapped_key, household_id, key_id FROM household.space_keys",
    );
    for (const out of [dry.out, real.out]) {
      expect(out).not.toContain(keyB64);
      expect(out).not.toContain(Buffer.from(keyB64, "base64").toString("hex"));
      expect(out).not.toContain(householdId);
      expect(out).not.toContain(password);
      for (const r of rows) {
        expect(out).not.toContain(r.wrapped_key);
        expect(out).not.toContain(r.household_id);
        expect(out).not.toContain(r.key_id);
      }
    }
  });

  it("NFR-01@PoC FR 3: the command refuses to run without a key file to re-wrap to, and with one others may read", async () => {
    const noKey = without(scriptEnv(), "WS_KMS_KEY_FILE", "WS_REAL_DATA");
    const none = await run("scripts/kms-rewrap.ts", [], noKey);
    expect(none.code).toBe(2);
    expect(none.out).toContain("WS_KMS_KEY_FILE");
    chmodSync(keyFile, 0o644);
    try {
      const open = await run("scripts/kms-rewrap.ts", [], scriptEnv());
      expect(open.code).toBe(1);
      expect(open.out).toContain("chmod 600");
      expect(open.out).not.toContain(readFileSync(keyFile, "utf8").trim());
    } finally {
      chmodSync(keyFile, 0o600);
    }
  });
});

describe("NFR-01@PoC criterion «Шифрування при зберіганні»: a real-data process does not start with the fixed-label key", () => {
  for (const role of ["api", "worker", "scheduler"]) {
    it(`NFR-01@PoC criterion «Шифрування при зберіганні»: ${role} with WS_REAL_DATA=true and no key file exits naming WS_KMS_KEY_FILE`, async () => {
      const env = without(scriptEnv(), "WS_KMS_KEY_FILE");
      const res = await run("src/main.ts", ["--role", role], { ...env, WS_PORT: "8084" });
      expect(res.code).toBe(1);
      expect(res.out).toContain("WS_KMS_KEY_FILE");
    });
  }

  it("NFR-01@PoC criterion «Шифрування при зберіганні»: a key file others may read stops the process; the message holds no key", async () => {
    chmodSync(keyFile, 0o640);
    try {
      const res = await run("src/main.ts", ["--role", "worker"], { ...scriptEnv(), WS_PORT: "8084" });
      expect(res.code).toBe(1);
      expect(res.out).toContain(`Local KMS key file ${keyFile}`);
      const keyB64 = (JSON.parse(readFileSync(keyFile, "utf8")) as { versions: Record<string, string> })
        .versions["inst-1"]!;
      expect(res.out).not.toContain(keyB64);
    } finally {
      chmodSync(keyFile, 0o600);
    }
  });
});

describe("NFR-01@PoC FR 3: a lost or wrong key file stops the start with a clear error, never a silent new key", () => {
  it("NFR-01@PoC FR 3: the key file lost after the move — the command exits 1, says so, leaves no new key file and changes nothing", async () => {
    expect((await versions()).every((v) => v.startsWith("inst-"))).toBe(true);
    const saved = `${keyFile}.saved`;
    const { renameSync, existsSync } = await import("node:fs");
    renameSync(keyFile, saved);
    try {
      const before = await owner.query(
        "SELECT key_id, master_key_version, wrapped_key FROM household.space_keys ORDER BY 1",
      );
      const res = await run("scripts/kms-rewrap.ts", [], scriptEnv());
      expect(res.code).toBe(1);
      expect(res.out).toContain("do not open with the installation's key file");
      expect(res.out).toContain("saved copy of the key file");
      expect(existsSync(keyFile)).toBe(false);
      const after = await owner.query(
        "SELECT key_id, master_key_version, wrapped_key FROM household.space_keys ORDER BY 1",
      );
      expect(after.rows).toEqual(before.rows);
    } finally {
      rmSync(keyFile, { force: true });
      renameSync(saved, keyFile);
    }
    const back = await run("scripts/kms-rewrap.ts", [], scriptEnv());
    expect(back.code).toBe(0);
  });

  it("NFR-01@PoC FR 3: another installation's key file — the command exits 1 and keeps that file; the message holds no key", async () => {
    const otherDir = mkdtempSync(path.join(os.tmpdir(), "ws-kms-other-"));
    const other = path.join(otherDir, "k", "local-kms-key.json");
    try {
      fileKeyManagement({ file: other });
      const res = await run("scripts/kms-rewrap.ts", [], { ...scriptEnv(), WS_KMS_KEY_FILE: other });
      expect(res.code).toBe(1);
      expect(res.out).toContain("do not open with the installation's key file");
      const keyB64 = (JSON.parse(readFileSync(other, "utf8")) as { versions: Record<string, string> })
        .versions["inst-1"]!;
      expect(res.out).not.toContain(keyB64);
      expect(readFileSync(other, "utf8")).toContain(keyB64);
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });
});
