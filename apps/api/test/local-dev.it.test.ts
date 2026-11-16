// #363 (follow-up of PR #351), acceptance: `pnpm local:dev` (scripts/local-dev.ts) on a real PostgreSQL starts
// beside a foreign server on 127.0.0.1:8082 (the Colima/Lima port forward of the owner's Mac), stops every child
// when its window closes (SIGHUP) or the script is killed, and stops the leftovers of an earlier run on the next
// start. It runs on its own throwaway database, directory and web port (localDevSettings), never on ws_dev.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOLDER_PID_ENV, LOCK_DATABASE, LOCK_NAME } from "../../../tools/test-guards/cluster-lock.mjs";
import {
  LOCK_HOLDER_SQL,
  PARENT_ENTRY,
  ephemeralPort,
  isPortFree,
  lockHolderMessage,
  parsePidsFile,
  type PidEntry,
} from "../scripts/lib/local-dev.ts";

const apiDir = fileURLToPath(new URL("..", import.meta.url));
const adminUrl = process.env["DATABASE_URL"]!;
const database = `ws_t_ld_${randomBytes(4).toString("hex")}`;
const stateDir = mkdtempSync(path.join(os.tmpdir(), "ws-local-dev-"));
const pidsFile = path.join(stateDir, "pids.json");

async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function allGone(pids: readonly number[], ms: number): Promise<number[]> {
  for (let waited = 0; waited < ms; waited += 200) {
    if (!pids.some(alive)) return [];
    await new Promise((r) => setTimeout(r, 200));
  }
  return pids.filter(alive);
}

let webPort = 0;
let holderPid = "";
let foreign: Server | undefined;
const started: ChildProcess[] = [];

interface Run {
  readonly child: ChildProcess;
  readonly output: () => string;
}

/** Starts the script and resolves once it prints «Willowsum is running» (rejects with its output otherwise). */
async function startRun(): Promise<Run> {
  const child = spawn(process.execPath, ["scripts/local-dev.ts"], {
    cwd: apiDir,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "",
      DATABASE_URL: adminUrl,
      WS_LOCAL_DEV_DATABASE: database,
      WS_LOCAL_DEV_STATE_DIR: stateDir,
      WS_LOCAL_DEV_WEB_PORT: String(webPort),
      // This test file already holds the cluster lock (its integration run): the script must not wait for itself.
      [HOLDER_PID_ENV]: holderPid,
    },
  });
  started.push(child);
  let out = "";
  child.stdout!.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr!.on("data", (d: Buffer) => (out += d.toString()));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`not running within 150 s:\n${out}`)), 150_000);
    child.stdout!.on("data", () => {
      if (out.includes("Willowsum is running")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`exited (${code}) before it was running:\n${out}`));
    });
  });
  return { child, output: () => out };
}

function children(): PidEntry[] {
  return parsePidsFile(readFileSync(pidsFile, "utf8")).filter((e) => e.name !== PARENT_ENTRY);
}

beforeAll(async () => {
  for (;;) {
    webPort = await ephemeralPort();
    if (webPort !== 8082 && (await isPortFree(webPort))) break;
  }
  // The lock session of this integration run (`pnpm db:test run`, or the globalSetup of the integration config).
  const holder = await query<{ pid: number; application_name: string }>(LOCK_HOLDER_SQL, [
    LOCK_NAME,
    LOCK_DATABASE,
  ]);
  holderPid = process.env[HOLDER_PID_ENV] ?? String(holder[0]?.pid ?? "");
  // A program listening only on 127.0.0.1:8082 (an ssh port forward on the owner's Mac). Busy already: just as good.
  const server = createServer();
  foreign = await new Promise<Server | undefined>((resolve) => {
    server.once("error", () => resolve(undefined));
    server.listen({ host: "127.0.0.1", port: 8082, exclusive: true }, () => resolve(server));
  });
}, 30_000);

afterAll(async () => {
  for (const c of started) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 1_000));
  if (existsSync(pidsFile))
    for (const e of children()) {
      try {
        process.kill(-e.pid, "SIGKILL");
      } catch {
        // gone
      }
    }
  if (foreign) await new Promise((r) => foreign!.close(r));
  await query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  rmSync(stateDir, { recursive: true, force: true });
}, 60_000);

describe("#363: pnpm local:dev on a machine where other programs hold ports", () => {
  it("the cluster lock holder is found and named (this integration run: tests)", async () => {
    const rows = await query<{ pid: number; application_name: string }>(LOCK_HOLDER_SQL, [
      LOCK_NAME,
      LOCK_DATABASE,
    ]);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.pid)).toBe(holderPid);
    expect(lockHolderMessage({ pid: rows[0]!.pid, applicationName: rows[0]!.application_name })).toMatch(
      /йдуть інтеграційні тести/,
    );
  });

  let first: Run;
  it("acceptance: a foreign server on 127.0.0.1:8082 and local:dev still starts; roles listen only on 127.0.0.1", async () => {
    expect(await isPortFree(8082)).toBe(false);
    first = await startRun();
    const roles = children().filter((e) => e.name !== "web");
    expect(roles.map((e) => e.name)).toEqual(["api", "worker", "scheduler"]);
    const response = await fetch(`http://localhost:${webPort}/v1/meta`);
    expect(response.status).toBe(200);
    // Each role's real port is in its log line «started»; none is 8082 and none answers on another address.
    for (const role of ["api", "worker", "scheduler"]) {
      const log = readFileSync(path.join(stateDir, `${role}.log`), "utf8");
      const port = Number(/"event":"started".*?"port":(\d+)/.exec(log)?.[1]);
      expect(port).toBeGreaterThan(0);
      expect(port).not.toBe(8082);
      expect((await fetch(`http://127.0.0.1:${port}/health/ready`)).status).toBe(200);
    }
  }, 180_000);

  let second: Run;
  it("a second start stops the leftovers of the first (same pid, start time and command line) and runs", async () => {
    const old = parsePidsFile(readFileSync(pidsFile, "utf8")).map((e) => e.pid);
    const before = (await query<{ now: Date }>("SELECT now()"))[0]!.now;
    second = await startRun();
    // The flag upsert on a second start moves changed_at (#363); every release flag is stored, including `data.bulk_actions`.
    expect(second.output()).not.toMatch(/Flag \S+ is not turned on/);
    const dbUrl = new URL(adminUrl);
    dbUrl.pathname = `/${database}`;
    const flagDb = new pg.Client({ connectionString: dbUrl.toString() });
    await flagDb.connect();
    const flags = (
      await flagDb.query<{ key: string; changed_at: Date }>("SELECT key, changed_at FROM feature_flags.flags")
    ).rows;
    await flagDb.end();
    expect(flags.length).toBeGreaterThan(0);
    for (const f of flags) expect(f.changed_at.getTime(), f.key).toBeGreaterThanOrEqual(before.getTime());
    expect(second.output()).toMatch(/Зупиняю те, що лишилося від попереднього `pnpm local:dev`/);
    expect(await allGone(old, 5_000)).toEqual([]);
    expect(first.child.exitCode ?? first.child.signalCode).not.toBeNull();
  }, 180_000);

  it("acceptance: after SIGHUP to the script (its window closed) no child remains", async () => {
    const pids = children().map((e) => e.pid);
    expect(pids).toHaveLength(4);
    const exited = new Promise((resolve) => second.child.once("exit", resolve));
    second.child.kill("SIGHUP");
    await exited;
    expect(await allGone(pids, 5_000)).toEqual([]);
    expect(existsSync(pidsFile)).toBe(false);
  }, 60_000);

  it("the script killed outright (SIGKILL, no handler runs): every child stops by itself", async () => {
    const run = await startRun();
    const pids = children().map((e) => e.pid);
    run.child.kill("SIGKILL");
    expect(await allGone(pids, 30_000)).toEqual([]);
  }, 240_000);
});
