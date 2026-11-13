import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erasureRoleName } from "../src/platform/modules/rules.ts";
import { personWithSpace, rowCount } from "./erasure-helpers.ts";
import { apiDir, realModules, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * NFR-12@PoC FR 3: the owner's allowlisted script `scripts/erasure.ts` as a process, with the processes' own
 * configuration: request, run, status. Its output holds ids, times and states — never the address.
 */
const run = promisify(execFile);
let db: RealModulesDatabase;
let dir: string;

beforeAll(async () => {
  db = await setupRealModules(2);
  dir = mkdtempSync(path.join(tmpdir(), "ws-erasure-script-"));
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await db?.close();
});

function env(): NodeJS.ProcessEnv {
  const url = new URL(db.url);
  const password = new URL(db.context.connectionString!).password;
  return {
    PATH: process.env["PATH"],
    DATABASE_URL: db.url,
    WS_DB_HOST: url.hostname,
    WS_DB_PORT: url.port || "5432",
    WS_DB_NAME: url.pathname.slice(1),
    WS_DB_SSL: "false",
    WS_DB_PROBE_PASSWORD: password,
    WS_DB_CONTEXT_PASSWORD: password,
    ...Object.fromEntries(
      realModules.map((m) => [`WS_DB_PASSWORD_${m.replaceAll("-", "_").toUpperCase()}`, password]),
    ),
    WS_ERASURE_LOG_DIR: dir,
  };
}

const script = (...args: string[]) =>
  run(process.execPath, [path.join(apiDir, "scripts/erasure.ts"), ...args], { cwd: apiDir, env: env() });

/** `request --email` with the address on stdin (never in argv). */
function requestByEmail(email: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [path.join(apiDir, "scripts/erasure.ts"), "request", "--email"],
      { cwd: apiDir, env: env() },
      (error, stdout, stderr) => (error ? reject(error) : resolve({ stdout, stderr })),
    );
    child.stdin!.end(`${email}\n`);
  });
}

describe("NFR-12@PoC FR 3: the owner's erasure script", () => {
  it("NFR-12@PoC FR 3: request, run and status erase the person's account and space; the address is never printed", async () => {
    const person = await personWithSpace(db, "script");
    const requested = await requestByEmail(person.email);
    expect(requested.stdout).not.toContain(person.email);
    expect(requested.stderr).not.toContain(person.email);
    const { requestId, state, dueAt } = JSON.parse(requested.stdout) as Record<string, string>;
    expect(state).toBe("pending");
    expect(dueAt).toMatch(/^\d{4}-/);
    const done = await script("run", requestId!);
    expect(done.stderr).not.toContain(person.email);
    expect(JSON.parse(done.stdout)).toMatchObject({ requestId, state: "completed" });
    expect(await rowCount(db, person.householdId)).toBe(0);
    const status = JSON.parse((await script("status")).stdout) as { requestId: string; state: string }[];
    expect(status).toEqual([expect.objectContaining({ requestId, state: "completed" })]);
    // The erasure roles can no longer log in.
    const { rows } = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ANY($1) AND rolcanlogin`,
      [realModules.map(erasureRoleName)],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("NFR-12@PoC FR 3: a bad command or a missing log folder is refused before anything runs", async () => {
    await expect(script("drop")).rejects.toMatchObject({ code: 2 });
    await expect(
      run(process.execPath, [path.join(apiDir, "scripts/erasure.ts"), "status"], {
        cwd: apiDir,
        env: { ...env(), WS_ERASURE_LOG_DIR: "" },
      }),
    ).rejects.toMatchObject({ code: 1 });
  });
});
