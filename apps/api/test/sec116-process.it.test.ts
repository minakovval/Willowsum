import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enableContextLogin, enableModuleLogin, enableProbeLogin } from "../src/platform/db/migrate.ts";
import { modulePasswordVariable } from "../src/platform/config/config.ts";
import { createTestDatabase } from "./db.ts";
import { migrateRealModules, realModules } from "./real-modules.ts";

const apiDir = fileURLToPath(new URL("..", import.meta.url));
const probePassword = randomBytes(12).toString("hex");

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

function baseEnv(port: number): Record<string, string> {
  const u = new URL(db.url);
  return {
    PATH: process.env["PATH"] ?? "",
    WS_PORT: String(port),
    WS_DB_HOST: u.hostname,
    WS_DB_PORT: u.port || "5432",
    WS_DB_NAME: u.pathname.slice(1),
    WS_DB_SSL: "false",
    WS_DB_PROBE_PASSWORD: probePassword,
    WS_DB_CONTEXT_PASSWORD: probePassword,
    // Every declared module needs the password of its role (not used by these probes).
    ...Object.fromEntries(realModules.map((m) => [modulePasswordVariable(m), probePassword])),
  };
}

interface Started {
  child: ChildProcess;
  output: () => string;
  exit: Promise<number | null>;
}

function start(role: string, env: Record<string, string>): Started {
  const child = spawn(process.execPath, ["src/main.ts", "--role", role], {
    cwd: apiDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (out += d));
  const exit = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, output: () => out, exit };
}

async function waitFor(url: string, status: number, timeoutMs: number): Promise<number> {
  const t0 = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.status === status) return Date.now() - t0;
    } catch {
      // not listening yet
    }
    if (Date.now() - t0 > timeoutMs)
      throw new Error(`${url} did not answer ${status} within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  // Readiness needs every migration the code ships (ARC-02 FR 4).
  await migrateRealModules(owner, db.url);
  await enableProbeLogin(owner, probePassword);
  // The api role reads flags and kill switches before it is ready (CICD-06): its module role and the binding role log in.
  await enableModuleLogin(owner, "feature-flags", probePassword);
  await enableContextLogin(owner, probePassword);
  for (const m of ["identity", "audit", "household"]) await enableModuleLogin(owner, m, probePassword);
  await owner.query(
    `INSERT INTO feature_flags.flags (key, stage, percent, fully_enabled_at) VALUES ('identity.sign-in', 'all', 100, now())
     ON CONFLICT (key) DO UPDATE SET stage = 'all', percent = 100, fully_enabled_at = now()`,
  );
});

afterAll(async () => {
  await owner?.end();
  await db?.drop();
});

/**
 * Security review of PR #116: main.ts hands WS_SIGNUP_ALLOWLIST to identity. Dropping that line (open sign-up in
 * staging and production) survived every other suite. The real process, a listed and an outside address.
 */
describe("sec#116: main.ts wires the family's list into sign-up", () => {
  it("an outside address gets the same answer and no account; a listed one gets an account", async () => {
    const port = await freePort();
    const listed = `sec116.listed.${randomBytes(4).toString("hex")}@example.test`;
    const outside = `sec116.outside.${randomBytes(4).toString("hex")}@example.test`;
    const p = start("api", { ...baseEnv(port), WS_SIGNUP_ALLOWLIST: ` ${listed.toUpperCase()} ` });
    try {
      await waitFor(`http://127.0.0.1:${port}/health/ready`, 200, 20_000);
      const signUp = (email: string) =>
        fetch(`http://127.0.0.1:${port}/v1/registrations`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:5173" },
          body: JSON.stringify({
            name: "Олена Синтетична",
            email,
            password: ["synthetic", "sec116", "process", "phrase"].join(" "),
            captchaToken: "synthetic-captcha-pass",
          }),
        });
      const [a, b] = [await signUp(outside), await signUp(listed)];
      expect([a.status, b.status], p.output()).toEqual([200, 200]);
      const accounts = async (email: string) =>
        (await owner.query(`SELECT 1 FROM identity.accounts WHERE email_normalized = $1`, [email])).rowCount;
      expect(await accounts(outside)).toBe(0);
      expect(await accounts(listed)).toBe(1);
    } finally {
      p.child.kill("SIGTERM");
      await p.exit;
    }
  });
});
