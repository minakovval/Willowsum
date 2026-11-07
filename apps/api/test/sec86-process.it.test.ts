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
});

afterAll(async () => {
  await owner?.end();
  await db?.drop();
});

/**
 * Security review of PR #86: main.ts passes WS_TRUSTED_PROXY_HOPS and WS_ALLOWED_ORIGINS to the server (the
 * PR's process test checks the defaults only, so dropping either wiring went unnoticed).
 */
describe("NFR-14 FR 8 / NFR-15 FR 5: main.ts wires the proxy hops and the allowed origins", () => {
  it("WS_TRUSTED_PROXY_HOPS=1: clients behind the proxy are counted apart; WS_ALLOWED_ORIGINS: its origin may write", async () => {
    const port = await freePort();
    const web = "https://app.sec86.example";
    const p = start("api", { ...baseEnv(port), WS_TRUSTED_PROXY_HOPS: "1", WS_ALLOWED_ORIGINS: web });
    await waitFor(`http://127.0.0.1:${port}/health/ready`, 200, 20_000);
    // 70 public requests from 70 clients behind one proxy (this machine): none is refused.
    const statuses: number[] = [];
    for (let i = 0; i < 70; i++)
      statuses.push(
        (
          await fetch(`http://127.0.0.1:${port}/v1/meta`, {
            headers: { "x-forwarded-for": `198.51.100.${i}` },
          })
        ).status,
      );
    expect(new Set(statuses)).toEqual(new Set([200]));
    // The configured origin passes the Origin check (then 401: no session); another one does not.
    const own = await fetch(`http://127.0.0.1:${port}/v1/me/permissions`, {
      method: "POST",
      headers: { origin: web },
    });
    expect(own.status).not.toBe(403);
    const local = await fetch(`http://127.0.0.1:${port}/v1/me/permissions`, {
      method: "POST",
      headers: { origin: "http://localhost:5173" },
    });
    expect(local.status).toBe(403);
    p.child.kill("SIGTERM");
    expect(await p.exit).toBe(0);
  });
});
