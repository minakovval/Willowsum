import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  enableContextLogin,
  enableModuleLogin,
  enableProbeLogin,
  migrate,
  pendingMigrations,
  readMigrations,
} from "../src/platform/db/migrate.ts";
import { modulePasswordVariable } from "../src/platform/config/config.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { migrateRealModules, realModules } from "./real-modules.ts";

const apiDir = fileURLToPath(new URL("..", import.meta.url));
const fixtures = fileURLToPath(new URL("./fixtures/db-modules", import.meta.url));
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

describe("ARC-02: one image, three roles, checked configuration, probes, graceful stop", () => {
  it("criterion «час старту до «готовий» ≤ 20 с»: the api role is ready within 20 s; SIGTERM stops it cleanly", async () => {
    const port = await freePort();
    const p = start("api", baseEnv(port));
    const elapsed = await waitFor(`http://127.0.0.1:${port}/health/ready`, 200, 20_000);
    expect(elapsed).toBeLessThanOrEqual(20_000);
    expect((await fetch(`http://127.0.0.1:${port}/health/live`)).status).toBe(200);
    p.child.kill("SIGTERM");
    expect(await p.exit).toBe(0);
    expect(p.output()).toContain('"outcome":"clean"');
  });

  it("ARC-07: the api role serves the /v1 API; a protected route without a session is a 401 problem", async () => {
    const port = await freePort();
    const p = start("api", baseEnv(port));
    await waitFor(`http://127.0.0.1:${port}/health/ready`, 200, 20_000);
    const meta = await fetch(`http://127.0.0.1:${port}/v1/meta`);
    expect(meta.status).toBe(200);
    expect(await meta.json()).toEqual({ apiVersion: "v1" });
    const me = await fetch(`http://127.0.0.1:${port}/v1/me/permissions`);
    expect(me.status).toBe(401);
    expect(me.headers.get("content-type")).toMatch(/^application\/problem\+json/);
    expect(await me.json()).toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    p.child.kill("SIGTERM");
    expect(await p.exit).toBe(0);
  });

  it("NFR-14 / NFR-15 FR 5: main.ts wires the headers, the rate limits and the Origin check of the api role", async () => {
    const port = await freePort();
    const p = start("api", baseEnv(port));
    await waitFor(`http://127.0.0.1:${port}/health/ready`, 200, 20_000);
    const live = await fetch(`http://127.0.0.1:${port}/health/live`);
    expect(live.headers.get("x-content-type-options")).toBe("nosniff");
    expect(live.headers.get("cache-control")).toBe("no-store");
    // Locally: no HSTS.
    expect(live.headers.get("strict-transport-security")).toBeNull();
    const evil = await fetch(`http://127.0.0.1:${port}/v1/me/permissions`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(evil.status).toBe(403);
    expect(await evil.json()).toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
    // At most 121 requests reach a 429 even if a minute boundary falls inside the loop.
    let refused: Response | undefined;
    let passed = 0;
    for (let i = 0; i < 121 && !refused; i++) {
      const r = await fetch(`http://127.0.0.1:${port}/v1/meta`);
      if (r.status === 429) refused = r;
      else passed += 1;
    }
    expect(passed).toBeGreaterThanOrEqual(60);
    expect(refused?.status).toBe(429);
    expect(Number(refused!.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    p.child.kill("SIGTERM");
    expect(await p.exit).toBe(0);
  });

  it("NFR-14: in staging HSTS is sent; the load-test setting switches the rate limits off (and is logged)", async () => {
    const port = await freePort();
    const p = start("api", {
      ...baseEnv(port),
      WS_TELEMETRY_ENVIRONMENT: "staging",
      WS_TELEMETRY: "off",
      WS_RATE_LIMITS: "off-load-test",
      // ACC-01 FR 12: a deployed api role runs the live CAPTCHA and mail adapters (synthetic values; no call is made).
      WS_PROVIDER_MODE: "live",
      WS_WEB_ORIGIN: "https://app.example.org",
      WS_CAPTCHA_SECRET: "synthetic-synthetic-synthetic",
      WS_MAIL_API_KEY: "synthetic-synthetic-synthetic",
      WS_MAIL_FROM: "Willowsum <no-reply@example.org>",
    });
    await waitFor(`http://127.0.0.1:${port}/health/ready`, 200, 20_000);
    const live = await fetch(`http://127.0.0.1:${port}/health/live`);
    expect(live.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    const statuses: number[] = [];
    for (let i = 0; i < 70; i++) statuses.push((await fetch(`http://127.0.0.1:${port}/v1/meta`)).status);
    expect(new Set(statuses)).toEqual(new Set([200]));
    p.child.kill("SIGTERM");
    expect(await p.exit).toBe(0);
    // WS_TELEMETRY=off (the PoC, owner 2026-11-12): no export, the events are structured JSON lines on stdout.
    const events = p
      .output()
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l) as { event?: unknown; severity?: unknown });
    expect(events).toContainEqual(
      expect.objectContaining({ event: "rate_limits.disabled", severity: "WARN" }),
    );
    expect(events).toContainEqual(expect.objectContaining({ event: "process.started", severity: "INFO" }));
  });

  it("ACC-01 FR 12: in staging the api role refuses to start without the live CAPTCHA (named, never echoed)", async () => {
    const port = await freePort();
    const p = start("api", { ...baseEnv(port), WS_TELEMETRY_ENVIRONMENT: "staging", WS_TELEMETRY: "off" });
    expect(await p.exit).toBe(1);
    expect(p.output()).toContain("WS_PROVIDER_MODE");
    expect(p.output()).toContain("WS_WEB_ORIGIN");
  });

  it("NFR-14 FR 10: the api role refuses to start with in-process counters and more than one instance", async () => {
    const port = await freePort();
    const p = start("api", { ...baseEnv(port), WS_API_INSTANCES: "2" });
    expect(await p.exit).toBe(1);
    expect(p.output()).toContain("WS_API_INSTANCES");
  });

  it("ARC-09 (review of PR #85): on SIGTERM telemetry is flushed last — the spans of the last requests reach the collector", async () => {
    const received: { path: string; body: string }[] = [];
    const collector = createHttpServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (c: Buffer) => chunks.push(c));
      request.on("end", () => {
        received.push({ path: request.url ?? "", body: Buffer.concat(chunks).toString("utf8") });
        response.writeHead(200, { "content-type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((resolve) => collector.listen(0, "127.0.0.1", resolve));
    try {
      const port = await freePort();
      const p = start("api", {
        ...baseEnv(port),
        WS_TELEMETRY: "otlp",
        WS_OTLP_ENDPOINT: `http://127.0.0.1:${(collector.address() as AddressInfo).port}/otlp`,
        WS_OTLP_AUTHORIZATION: "Basic c3ludGhldGljOnRva2VuLXZhbHVl",
      });
      await waitFor(`http://127.0.0.1:${port}/health/ready`, 200, 20_000);
      expect((await fetch(`http://127.0.0.1:${port}/v1/meta`)).status).toBe(200);
      // Sent at once: the batch exporter's own 5 s delay has not passed, only the stop flushes the span.
      p.child.kill("SIGTERM");
      expect(await p.exit).toBe(0);
      const traces = received
        .filter((r) => r.path === "/otlp/v1/traces")
        .map((r) => r.body)
        .join("\n");
      expect(traces).toContain("/v1/meta");
    } finally {
      await new Promise<void>((resolve) => collector.close(() => resolve()));
    }
  });

  it("ARC-07: the worker role serves only the probes, no API", async () => {
    const port = await freePort();
    const p = start("worker", baseEnv(port));
    await waitFor(`http://127.0.0.1:${port}/health/ready`, 200, 20_000);
    expect((await fetch(`http://127.0.0.1:${port}/v1/meta`)).status).toBe(404);
    p.child.kill("SIGTERM");
    expect(await p.exit).toBe(0);
  });

  it.each(["worker", "scheduler"])(
    "the %s role starts from the same entry point and serves the probes",
    async (role) => {
      const port = await freePort();
      const p = start(role, baseEnv(port));
      await waitFor(`http://127.0.0.1:${port}/health/ready`, 200, 20_000);
      expect(p.output()).toContain(`"role":"${role}"`);
      p.child.kill("SIGTERM");
      expect(await p.exit).toBe(0);
    },
  );

  it("criterion «старт із пропущеним обов'язковим секретом»: refuses to start, names the variable, prints no value", async () => {
    const env = baseEnv(await freePort());
    delete env["WS_DB_PROBE_PASSWORD"];
    const p = start("api", { ...env, WS_DB_SSL: "sometimes" });
    expect(await p.exit).toBe(1);
    expect(p.output().trim()).toBe("Configuration error: missing or invalid WS_DB_PROBE_PASSWORD, WS_DB_SSL");
    expect(p.output()).not.toContain(probePassword);
    expect(p.output()).not.toContain("sometimes");
  });

  it("«готовий» is 503 while the database cannot be reached; «живий» stays 200", async () => {
    const port = await freePort();
    const p = start("api", { ...baseEnv(port), WS_DB_PORT: String(await freePort()) });
    await waitFor(`http://127.0.0.1:${port}/health/live`, 200, 20_000);
    const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "not-ready", reason: "database-unreachable" });
    p.child.kill("SIGTERM");
    expect(await p.exit).toBe(0);
  });

  it("a database restart does not crash the process: live stays 200 and ready recovers", async () => {
    const port = await freePort();
    const p = start("api", baseEnv(port));
    await waitFor(`http://127.0.0.1:${port}/health/ready`, 200, 20_000);
    // The probe's idle connection is killed, as in a restart or failover.
    await owner.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'ws_probe' AND datname = current_database()",
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(p.child.exitCode).toBeNull();
    expect((await fetch(`http://127.0.0.1:${port}/health/live`)).status).toBe(200);
    await waitFor(`http://127.0.0.1:${port}/health/ready`, 200, 5_000);
    expect(p.output()).not.toContain("Unhandled");
    p.child.kill("SIGTERM");
    expect(await p.exit).toBe(0);
  });

  it("ws_probe can only read the applied-migrations list", async () => {
    await migrate(owner, { modules: ["alpha"], modulesDir: fixtures });
    const probe = new pg.Client({ connectionString: urlAs(db.url, "ws_probe", probePassword) });
    await probe.connect();
    const code = async (sql: string) =>
      probe.query(sql).then(
        () => "ok",
        (e: { code?: string }) => e.code,
      );
    try {
      expect(await code("SELECT count(*) FROM platform_migrations.applied")).toBe("ok");
      expect(
        await code("INSERT INTO platform_migrations.applied (module, name, checksum) VALUES ('x', 'y', 'z')"),
      ).toBe("42501");
      expect(await code("UPDATE platform_migrations.applied SET checksum = 'x'")).toBe("42501");
      expect(await code("DELETE FROM platform_migrations.applied")).toBe("42501");
      expect(await code("SELECT * FROM alpha.items")).toBe("42501");
      expect(await code("CREATE TABLE public.sneaky (id int)")).toBe("42501");
      expect(await code("CREATE TEMP TABLE t (id int)")).toBe("42501");
    } finally {
      await probe.end();
    }
  });

  it("«готовий» checks the schema version: a migration the code ships but the database lacks makes it not ready", async () => {
    const expected = readMigrations({ modules: ["beta"], modulesDir: fixtures });
    expect(await pendingMigrations(owner, expected)).toEqual(["beta/0001_items.sql"]);
    await migrate(owner, { modules: ["beta"], modulesDir: fixtures });
    expect(await pendingMigrations(owner, expected)).toEqual([]);
    // The database may be ahead of the code (expand → migrate → contract).
    expect(await pendingMigrations(owner, [])).toEqual([]);
  });
});
