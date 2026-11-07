import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { createFlagAdminFor, createFlagRuntimeFor } from "../src/modules/feature-flags/index.ts";
import { modulePasswordVariable } from "../src/platform/config/config.ts";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { enableContextLogin, enableModuleLogin, enableProbeLogin } from "../src/platform/db/migrate.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { moduleRoleName } from "../src/platform/modules/rules.ts";
import { contextPoolOptions, modulePoolOptions } from "../src/wiring.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { householdA, householdB } from "./http.ts";
import { migrateRealModules, realModules } from "./real-modules.ts";

/**
 * Security review of PR #83 at 6ce7f5a on a real PostgreSQL: the 5 s limits hold on every connection of the
 * feature-flags and ws_context pools (new ones after an error or a reconnect too), a binding that times out
 * fails closed, a test-space lookup that times out keeps the function hidden and is not remembered — and the
 * api process (main.ts) really applies those pool settings. Each test kills a mutant the PR's tests let
 * through, named in the test.
 */
const apiDir = fileURLToPath(new URL("..", import.meta.url));
const staff = { kind: "staff" as const, id: "1e2d3c4b-5a69-4788-9a6b-5c4d3e2f1a07" };
const password = randomBytes(12).toString("hex");

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;

async function code(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "ok",
    (e: { code?: string; message: string }) => e.code ?? e.message,
  );
}

/** Holds an ACCESS EXCLUSIVE lock on a table from a separate owner session until `release()`. */
async function lock(table: string): Promise<{ release: () => Promise<void> }> {
  const c = new pg.Client({ connectionString: db.url });
  await c.connect();
  await c.query("BEGIN");
  await c.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
  return {
    release: async () => {
      await c.query("ROLLBACK");
      await c.end();
    },
  };
}

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  await enableProbeLogin(owner, password);
  await enableContextLogin(owner, password);
  for (const m of realModules) await enableModuleLogin(owner, m, password);
  databases = new ModuleDatabases({
    connectionFor: (module) => ({
      connectionString: urlAs(db.url, moduleRoleName(module), password),
      ...modulePoolOptions(module),
    }),
    context: { connectionString: urlAs(db.url, CONTEXT_ROLE, password), ...contextPoolOptions() },
    poolSize: 2,
  });
});

afterAll(async () => {
  await databases?.end();
  await owner?.end();
  await db?.drop();
});

describe("CICD-06: a binding that times out fails closed, on every ws_context connection", () => {
  it("a blocked binding ends after ~5 s, the module's work never runs; again on a fresh connection", async () => {
    const held = await lock("platform_context.bindings");
    try {
      for (let round = 0; round < 2; round++) {
        let ran = false;
        const t0 = Date.now();
        const outcome = await code(
          databases.for("feature-flags").inHousehold(householdB, async () => {
            ran = true;
          }),
        );
        expect(outcome, `round ${round}`).toBe("57014");
        expect(Date.now() - t0).toBeLessThan(6_500);
        expect(ran).toBe(false);
        // Every ws_context connection is replaced: the next binding runs on a new one, with the same limit.
        await owner.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND datname = current_database()",
          [CONTEXT_ROLE],
        );
      }
    } finally {
      await held.release();
    }
    // Afterwards the binding works again and binds the right household.
    const seen = await databases
      .for("feature-flags")
      .inHousehold(
        householdA,
        async (q) => (await q.query<{ h: string }>("SELECT $1::uuid AS h", [q.householdId])).rows[0]!.h,
      );
    expect(seen).toBe(householdA);
  }, 30_000);

  it("every feature-flags connection carries the 5 s limit, also after the backends are terminated", async () => {
    const show = () =>
      databases
        .for("feature-flags")
        .transaction(
          async (q) =>
            (await q.query<{ statement_timeout: string }>("SHOW statement_timeout")).rows[0]!
              .statement_timeout,
        );
    // Two connections in use at once (poolSize 2), then fresh ones after a reconnect.
    expect(await Promise.all([show(), show()])).toEqual(["5s", "5s"]);
    await owner.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND datname = current_database()",
      [moduleRoleName("feature-flags")],
    );
    await new Promise((r) => setTimeout(r, 200));
    const after = await Promise.all([show().catch(() => show()), show().catch(() => show())]);
    expect(after).toEqual(["5s", "5s"]);
  });
});

describe("CICD-06: a test-space lookup that times out keeps the function hidden and is not remembered", () => {
  it("while the binding is blocked the test space is hidden after ~2 s; once it works the space sees the function", async () => {
    const audit = createAuditLog(databases.for("audit"));
    const admin = createFlagAdminFor(databases.for("feature-flags"), audit, realModules);
    await admin.setTestHousehold(staff, householdA, true);
    await admin.setRollout(staff, "household.core", { stage: "test" });
    const runtime = createFlagRuntimeFor(databases.for("feature-flags"), { now: () => 1_000_000 });
    await runtime.refresh();
    expect(runtime.loaded).toBe(true);

    const held = await lock("platform_context.bindings");
    try {
      const t0 = Date.now();
      expect(await runtime.isEnabled(householdA, "household.core")).toBe(false);
      expect(Date.now() - t0).toBeLessThan(3_000);
      expect(await runtime.enabledFlags(householdA)).toEqual([]);
    } finally {
      await held.release();
    }
    // Not remembered: the next request asks again and gets the real answer (the snapshot is unchanged).
    expect(await runtime.isEnabled(householdA, "household.core")).toBe(true);
    expect(await runtime.isEnabled(householdB, "household.core")).toBe(false);
  }, 30_000);
});

describe("CICD-06: the api process applies the pool limits (main.ts → src/wiring.ts)", () => {
  async function freePort(): Promise<number> {
    return new Promise((resolve) => {
      const s = createServer().listen(0, () => {
        const { port } = s.address() as { port: number };
        s.close(() => resolve(port));
      });
    });
  }

  /** Starts the api role, holds `table` locked while its first flag load runs, and reports the longest wait of `role`. */
  async function longestWait(table: string, role: string): Promise<number> {
    const held = await lock(table);
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
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exit = new Promise((resolve) => child.on("exit", resolve));
    let longest = 0;
    let seen = false;
    try {
      const t0 = Date.now();
      while (Date.now() - t0 < 9_000) {
        // Each readiness probe starts (or joins) the flag load.
        void fetch(`http://127.0.0.1:${port}/health/ready`).catch(() => undefined);
        const { rows } = await owner.query<{ ms: number }>(
          `SELECT (extract(epoch FROM now() - query_start) * 1000)::int AS ms FROM pg_stat_activity
            WHERE datname = current_database() AND usename = $1 AND state = 'active'`,
          [role],
        );
        for (const r of rows) {
          seen = true;
          longest = Math.max(longest, r.ms);
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      await held.release();
      child.kill("SIGTERM");
      await exit;
    }
    expect(seen, `${role} was never seen waiting on ${table}`).toBe(true);
    return longest;
  }

  // Mutants: main.ts without `...contextPoolOptions()` / without `...modulePoolOptions(module)` — the PR tests
  // the option builders, not that main.ts uses them.
  it("a blocked binding of the api process ends within ~5 s (ws_context pool)", async () => {
    expect(await longestWait("platform_context.bindings", CONTEXT_ROLE)).toBeLessThan(5_800);
  }, 40_000);

  it("a blocked flag read of the api process ends within ~5 s (feature-flags pool)", async () => {
    expect(await longestWait("feature_flags.flags", moduleRoleName("feature-flags"))).toBeLessThan(5_800);
  }, 40_000);
});
