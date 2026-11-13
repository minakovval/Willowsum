import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { modulePasswordVariable } from "../src/platform/config/config.ts";
import { enableContextLogin, enableModuleLogin, enableProbeLogin } from "../src/platform/db/migrate.ts";
import { createTestDatabase } from "./db.ts";
import { migrateRealModules, realModules } from "./real-modules.ts";

/**
 * ARC-02@PoC FR 1 with ARC-04: one entry point (one image) runs as the API, the job worker or the scheduler; the
 * `--role` argument alone decides which. Only the worker role starts the job queue's loop (and stops it on SIGTERM).
 */
const apiDir = fileURLToPath(new URL("..", import.meta.url));
const secret = randomBytes(12).toString("hex");
let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

function env(port: number): Record<string, string> {
  const u = new URL(db.url);
  return {
    PATH: process.env["PATH"] ?? "",
    WS_PORT: String(port),
    WS_DB_HOST: u.hostname,
    WS_DB_PORT: u.port || "5432",
    WS_DB_NAME: u.pathname.slice(1),
    WS_DB_SSL: "false",
    WS_DB_PROBE_PASSWORD: secret,
    WS_DB_CONTEXT_PASSWORD: secret,
    // Log records to standard output (the server log), so the test reads which loops a role started.
    WS_TELEMETRY: "off",
    ...Object.fromEntries(realModules.map((m) => [modulePasswordVariable(m), secret])),
  };
}

async function run(role: string): Promise<{ output: string; code: number | null }> {
  const port = await freePort();
  const child = spawn(process.execPath, ["src/main.ts", "--role", role], {
    cwd: apiDir,
    env: env(port),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exit = new Promise<number | null>((resolve) => child.on("exit", resolve));
  for (const t0 = Date.now(); ;) {
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`).then(
      (r) => r.status === 200,
      () => false,
    );
    if (ready) break;
    if (Date.now() - t0 > 20_000) {
      child.kill("SIGKILL");
      throw new Error(`the ${role} role was not ready: ${output}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill("SIGTERM");
  const code = await exit;
  return { output, code };
}

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  await enableProbeLogin(owner, secret);
  await enableModuleLogin(owner, "feature-flags", secret);
  await enableContextLogin(owner, secret);
});

afterAll(async () => {
  await owner?.end();
  await db?.drop();
});

describe("ARC-02@PoC FR 1: one image, three roles chosen by the start command", () => {
  it("ARC-02@PoC FR 1: the same entry point runs each role; only the worker starts the job queue and stops it cleanly", async () => {
    const outputs: Record<string, string> = {};
    for (const role of ["api", "worker", "scheduler"]) {
      const { output, code } = await run(role);
      expect(code).toBe(0);
      expect(output).toContain(`"role":"${role}"`);
      expect(output).toContain('"outcome":"clean"');
      outputs[role] = output;
    }
    expect(outputs["worker"]).toContain('"worker.started"');
    expect(outputs["api"]).not.toContain("worker.started");
    expect(outputs["scheduler"]).not.toContain("worker.started");
  });
});
