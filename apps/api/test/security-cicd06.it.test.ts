import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { AUDIT_ENTITY, createFlagAdminFor } from "../src/modules/feature-flags/index.ts";
import { modulePasswordVariable } from "../src/platform/config/config.ts";
import { enableContextLogin, enableModuleLogin, enableProbeLogin } from "../src/platform/db/migrate.ts";
import { householdA } from "./http.ts";
import { realModules, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of CICD-06 (PR #82) on a real PostgreSQL: properties the PR's own tests did not pin — each
 * test here kills a mutant that survived them (named in the test).
 */
const staff = { kind: "staff" as const, id: "1e2d3c4b-5a69-4788-9a6b-5c4d3e2f1a07" };
const apiDir = fileURLToPath(new URL("..", import.meta.url));

let db: RealModulesDatabase;

async function code(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "ok",
    (e: { code?: string; message: string }) => e.code ?? e.message,
  );
}

beforeAll(async () => {
  db = await setupRealModules();
  const admin = createFlagAdminFor(
    db.databases.for("feature-flags"),
    createAuditLog(db.databases.for("audit")),
    realModules,
  );
  await admin.setRollout(staff, "household.core", { stage: "test" });
  await admin.setKillSwitch(staff, "access-scope", true);
  await admin.setTestHousehold(staff, householdA, true);
});

afterAll(async () => {
  await db?.close();
});

describe("П-10: audit.platform_entries is append-only for every role, like audit.entries", () => {
  // Mutants: the TRUNCATE trigger dropped; the row trigger on DELETE only — the PR tests the owner's DELETE only.
  it.each([
    ["UPDATE", "UPDATE audit.platform_entries SET action = 'delete'"],
    ["DELETE", "DELETE FROM audit.platform_entries"],
    ["TRUNCATE", "TRUNCATE audit.platform_entries"],
  ])("even the schema owner gets no %s", async (_, sql) => {
    const { rows } = await db.owner.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit.platform_entries",
    );
    expect(rows[0]!.n).toBeGreaterThan(0);
    await expect(db.owner.query(sql)).rejects.toThrow(/append-only/);
  });

  // Mutant: GRANT INSERT (occurred_at, …) — module SQL could backdate a flag change.
  it.each([
    ["occurred_at", "'2020-01-01T00:00:00Z'"],
    ["id", "gen_random_uuid()"],
  ])(
    "module SQL cannot set %s of a platform entry (no backdated or chosen entries)",
    async (column, value) => {
      const sql = `INSERT INTO platform_entries (${column}, actor_kind, channel, entity_type, entity_id, action, changes)
                 VALUES (${value}, 'system', 'system', 'feature-flags.flag', gen_random_uuid(), 'update', '[]')`;
      expect(await code(db.databases.for("audit").transaction((q) => q.query(sql)))).toBe("42501");
    },
  );

  it("the platform log holds no space: no household column, and no entry about a test-space mark", async () => {
    const { rows: cols } = await db.owner.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'audit' AND table_name = 'platform_entries' AND column_name = 'household_id'`,
    );
    expect(cols).toEqual([]);
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit.platform_entries
        WHERE entity_type = $1 OR entity_id = $2 OR changes::text LIKE '%' || $2 || '%'`,
      [AUDIT_ENTITY.testHousehold, householdA],
    );
    expect(rows[0]!.n).toBe(0);
  });
});

describe("CICD-06: no other module's role can change flags, kill switches, test marks or the platform log", () => {
  const targets = [
    "INSERT INTO feature_flags.flags (key, stage, percent, fully_enabled_at) VALUES ('x.y', 'all', 100, now())",
    "UPDATE feature_flags.flags SET stage = 'off', percent = 0, fully_enabled_at = NULL",
    "UPDATE feature_flags.kill_switches SET disabled = false",
    "DELETE FROM feature_flags.kill_switches",
    "UPDATE feature_flags.test_households SET unmarked_at = now()",
    "SELECT * FROM feature_flags.flags",
    `INSERT INTO audit.platform_entries (actor_kind, channel, entity_type, entity_id, action, changes)
     VALUES ('system', 'system', 'feature-flags.flag', gen_random_uuid(), 'update', '[]')`,
  ];
  it.each(realModules.filter((m) => m !== "feature-flags" && m !== "audit"))(
    "%s: every write (and read) of those tables is refused (42501)",
    async (module) => {
      for (const sql of targets)
        expect(await code(db.databases.for(module).transaction((q) => q.query(sql))), sql).toBe("42501");
    },
  );

  it("the feature-flags role cannot write the platform log directly (only through the audit module)", async () => {
    expect(await code(db.databases.for("feature-flags").transaction((q) => q.query(targets.at(-1)!)))).toBe(
      "42501",
    );
  });

  it("the stored state is unchanged by those attempts", async () => {
    const { rows } = await db.owner.query<{ stage: string; killed: boolean }>(
      `SELECT (SELECT stage FROM feature_flags.flags WHERE key = 'household.core') AS stage,
              (SELECT disabled FROM feature_flags.kill_switches WHERE module = 'access-scope') AS killed`,
    );
    expect(rows[0]).toEqual({ stage: "test", killed: true });
  });
});

describe("CICD-06 / ADR-0004: until the flags are loaded the api role is not ready and every module answers 503", () => {
  async function freePort(): Promise<number> {
    return new Promise((resolve) => {
      const s = createServer().listen(0, () => {
        const { port } = s.address() as { port: number };
        s.close(() => resolve(port));
      });
    });
  }

  // Mutant: readiness without the flags check (main.ts) — no PR test starts the api role without its flags.
  it("the feature-flags role cannot log in: /health/ready is 503 flags-not-loaded, module routes 503, platform routes work", async () => {
    const password = randomBytes(12).toString("hex");
    const owner = db.owner as unknown as pg.ClientBase;
    await enableProbeLogin(owner, password);
    await enableContextLogin(owner, password);
    for (const m of realModules) await enableModuleLogin(owner, m, password);
    const u = new URL(db.url);
    const port = await freePort();
    const child = spawn(process.execPath, ["src/main.ts", "--role", "api"], {
      cwd: apiDir,
      env: {
        PATH: process.env["PATH"] ?? "",
        WS_PORT: String(port),
        WS_DB_HOST: u.hostname,
        WS_DB_PORT: u.port || "5432",
        WS_DB_NAME: u.pathname.slice(1),
        WS_DB_SSL: "false",
        WS_DB_PROBE_PASSWORD: password,
        WS_DB_CONTEXT_PASSWORD: password,
        ...Object.fromEntries(realModules.map((m) => [modulePasswordVariable(m), password])),
        [modulePasswordVariable("feature-flags")]: `${password}-wrong`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exit = new Promise((resolve) => child.on("exit", resolve));
    try {
      const base = `http://127.0.0.1:${port}`;
      const t0 = Date.now();
      for (;;) {
        const live = await fetch(`${base}/health/live`).catch(() => undefined);
        if (live?.status === 200) break;
        if (Date.now() - t0 > 20_000) throw new Error("not live");
        await new Promise((r) => setTimeout(r, 100));
      }
      const ready = await fetch(`${base}/health/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ status: "not-ready", reason: "flags-not-loaded" });
      const me = await fetch(`${base}/v1/me/permissions`);
      expect(me.status).toBe(503);
      expect(await me.json()).toMatchObject({ code: "MODULE_UNAVAILABLE" });
      expect((await fetch(`${base}/v1/meta`)).status).toBe(200);
    } finally {
      child.kill("SIGTERM");
      await exit;
    }
  });
});
