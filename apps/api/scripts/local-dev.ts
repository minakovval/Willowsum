/**
 * `pnpm local:dev` (CICD-04@PoC: the local environment starts with one command): the whole app on this machine for
 * a person to click through — the API, worker and scheduler processes (ARC-02) and the web app's dev server, on a
 * persistent database of the `pnpm local:up` PostgreSQL, with synthetic providers only (nothing leaves the machine).
 *
 *   DATABASE_URL=<superuser URL of the local server> node scripts/local-dev.ts [--fresh]
 * (`pnpm local:dev` starts the local services and passes the URL.)
 *
 * The database is prepared the way the local environment documents it (README): `db:bootstrap` once, the
 * migrations on every start, a login for every module role with a password made for this run (never printed),
 * every release flag on. Letters stay inside the API process (synthetic mail), so the prompt prints the confirmation
 * link of an email typed there. Module roles belong to the whole cluster and this run sets their passwords, so it
 * holds the cluster lock (tools/test-guards/cluster-lock.mjs) until it stops: integration runs on the same server wait.
 *
 * On macOS beside other tools (#363): the role ports are picked free on every start and the roles listen only on
 * 127.0.0.1; closing the Terminal window (SIGHUP) or killing this script stops every child (lib/parent-watch.ts);
 * the pids of a run are kept in infra/local/.state/dev/pids.json and the next start stops what is still ours; while
 * it waits for the cluster lock it says who holds it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { HOLDER_PID_ENV, LOCK_DATABASE, LOCK_NAME } from "../../../tools/test-guards/cluster-lock.mjs";
import { FLAGS } from "../src/modules/feature-flags/index.ts";
import {
  bootstrapDatabase,
  enableContextLogin,
  enableModuleLogin,
  enableProbeLogin,
  migrate,
} from "../src/platform/db/migrate.ts";
import type { SchemaExemptions } from "../src/platform/db/schema-rules.ts";
import { topologicalOrder, type ModuleRules } from "../src/platform/modules/rules.ts";
import { acquireClusterLock } from "../test/cluster-lock.ts";
import {
  LOCAL_DEV_USAGE,
  LOCAL_HOST,
  LOCK_HOLDER_SQL,
  PARENT_ENTRY,
  ROLES,
  assertLocalServer,
  busyPortsMessage,
  cleanLeftovers,
  confirmationLink,
  databaseUrlFor,
  lastLines,
  localDevApplicationName,
  localDevSettings,
  lockHolderMessage,
  makeStopper,
  parseLocalDevArgs,
  parsePidsFile,
  parsePrompt,
  pickRolePorts,
  processIdentity,
  readinessTimeoutMessage,
  releaseFlagKeys,
  roleEnv,
  webEnv,
  webOrigin,
  type LocalDevOptions,
  type LocalDevSettings,
  type LockHolder,
  type PidEntry,
  type ProbeAnswer,
} from "./lib/local-dev.ts";

const apiDir = fileURLToPath(new URL("..", import.meta.url));
const repoDir = path.resolve(apiDir, "../..");
const parentWatch = fileURLToPath(new URL("./lib/parent-watch.ts", import.meta.url));

// The Terminal window may be gone: a failed write to it must not stop the script before it stops its children.
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

let options: LocalDevOptions;
let settings: LocalDevSettings;
try {
  options = parseLocalDevArgs(process.argv.slice(2));
  settings = localDevSettings(process.env, path.join(repoDir, "infra/local/.state/dev"));
} catch (error) {
  console.error(`${(error as Error).message}\n${LOCAL_DEV_USAGE}`);
  process.exit(2);
}
const adminUrl = process.env["DATABASE_URL"];
if (!adminUrl) {
  console.error("DATABASE_URL (a superuser URL of the local PostgreSQL) is not set; run `pnpm local:dev`.");
  process.exit(2);
}
try {
  assertLocalServer(adminUrl);
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}

const logDir = settings.stateDir;
const pidsFile = path.join(logDir, "pids.json");
const shown = (p: string) => (p.startsWith(repoDir) ? path.relative(repoDir, p) : p);
mkdirSync(logDir, { recursive: true, mode: 0o700 });

// What an earlier run left behind (its window closed, the script killed) holds the web port and the cluster lock.
let previous: PidEntry[] = [];
try {
  previous = parsePidsFile(readFileSync(pidsFile, "utf8"));
} catch {
  // no earlier run
}
await cleanLeftovers(previous);

const web = webOrigin(settings.webPort);
const busy = await busyPortsMessage([settings.webPort]);
if (busy) {
  console.error(busy);
  process.exit(2);
}
const ports = await pickRolePorts(settings.webPort);

const pids: PidEntry[] = [];
function recordPid(name: string, pid: number | undefined): void {
  const identity = pid === undefined ? undefined : processIdentity(pid);
  if (pid === undefined || identity === undefined) return;
  pids.push({ name, pid, identity });
  const tmp = `${pidsFile}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(pids, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, pidsFile);
}
recordPid(PARENT_ENTRY, process.pid);

const modules = topologicalOrder(
  JSON.parse(readFileSync(path.join(apiDir, "module-rules.json"), "utf8")) as ModuleRules,
);
const devUrl = databaseUrlFor(adminUrl, settings.database);

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Creates (or with --fresh recreates) the development database; true when it is new and needs bootstrap. */
async function ensureDatabase(): Promise<boolean> {
  const name = settings.database;
  return withClient(adminUrl!, async (admin) => {
    if (options.fresh) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (rowCount === 1) return false;
    await admin.query(`CREATE DATABASE ${name}`);
    return true;
  });
}

async function prepareDatabase(created: boolean, password: string): Promise<void> {
  await withClient(devUrl, async (owner) => {
    if (created) await bootstrapDatabase(owner);
    const { applied } = await migrate(owner, {
      modules,
      modulesDir: path.join(apiDir, "src/modules"),
      exemptions: JSON.parse(
        readFileSync(path.join(apiDir, "schema-exemptions.json"), "utf8"),
      ) as SchemaExemptions,
    });
    console.log(applied.length > 0 ? `Applied ${applied.length} migrations.` : "Database is up to date.");
    for (const module of modules) await enableModuleLogin(owner, module, password);
    await enableContextLogin(owner, password);
    await enableProbeLogin(owner, password);
    for (const key of releaseFlagKeys(FLAGS)) {
      await owner
        .query(
          `INSERT INTO feature_flags.flags (key, stage, percent, fully_enabled_at) VALUES ($1, 'all', 100, now())
           ON CONFLICT (key) DO UPDATE SET stage = 'all', percent = 100,
             fully_enabled_at = COALESCE(feature_flags.flags.fully_enabled_at, now())`,
          [key],
        )
        .catch((error: Error) => console.log(`Flag ${key} is not turned on: ${error.message}`));
    }
  });
}

/** The session that holds the cluster lock now, if any. */
async function lockHolder(): Promise<LockHolder | undefined> {
  return withClient(adminUrl!, async (c) => {
    const { rows } = await c.query<{ pid: number; application_name: string }>(LOCK_HOLDER_SQL, [
      LOCK_NAME,
      LOCK_DATABASE,
    ]);
    return rows[0] ? { pid: rows[0].pid, applicationName: rows[0].application_name } : undefined;
  }).catch(() => undefined);
}

/** Takes the cluster lock; while it waits, says who holds it and what to do (once, and again when that changes). */
async function takeClusterLock(): Promise<() => Promise<void>> {
  let said: number | undefined | null = null; // null: nothing said yet
  const say = async () => {
    const holder = await lockHolder();
    // The first time always (even when the holder could not be read), then whenever the holder changes.
    if (said === null || (holder && holder.pid !== said)) {
      said = holder?.pid;
      console.log(lockHolderMessage(holder));
    }
  };
  let timer: NodeJS.Timeout | undefined;
  try {
    return await acquireClusterLock({
      databaseUrl: adminUrl,
      // Inside `pnpm db:test run` (the integration test of this script) the run's own lock session holds it.
      holderPid: process.env[HOLDER_PID_ENV],
      applicationName: localDevApplicationName(),
      log: () => {
        void say();
        timer = setInterval(() => void say(), 5_000);
      },
    });
  } finally {
    clearInterval(timer);
  }
}

interface Running {
  readonly name: string;
  readonly child: ChildProcess;
  readonly log: string;
  exited: boolean;
}
const running: Running[] = [];

function start(name: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Running {
  const log = path.join(logDir, `${name}.log`);
  const out = createWriteStream(log, { mode: 0o600 });
  // Own process group: Ctrl+C reaches only this script, which stops the children in order. Each child watches
  // this script (parent-watch.ts) and stops by itself when it is gone.
  const child = spawn(process.execPath, ["--import", parentWatch, ...args], {
    cwd,
    env: { ...env, WS_LOCAL_DEV_PARENT_PID: String(process.pid) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout!.pipe(out);
  child.stderr!.pipe(out);
  const entry: Running = { name, child, log, exited: false };
  child.on("exit", (code) => {
    entry.exited = true;
    if (!stopRequested) {
      console.error(`\n${name} stopped (exit ${code}); see ${shown(log)}`);
      void stop(1);
    }
  });
  running.push(entry);
  recordPid(name, child.pid);
  return entry;
}

function logTail(log: string): string {
  try {
    return lastLines(readFileSync(log, "utf8"));
  } catch {
    return "";
  }
}

async function waitReady(url: string, entry: Running, timeoutMs = 60_000): Promise<void> {
  const t0 = Date.now();
  let answer: ProbeAnswer | undefined;
  for (;;) {
    if (entry.exited)
      throw new Error(
        `${entry.name} зупинився, не ставши готовим. Останні рядки ${shown(entry.log)}:\n${logTail(entry.log)}`,
      );
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.status === 200) return;
      answer = { status: response.status, body: (await response.text()).slice(0, 2_000) };
    } catch {
      // not listening yet
    }
    if (Date.now() - t0 > timeoutMs)
      throw new Error(
        readinessTimeoutMessage({
          name: entry.name,
          seconds: timeoutMs / 1000,
          url,
          answer,
          log: shown(entry.log),
          logTail: logTail(entry.log),
        }),
      );
    await new Promise((r) => setTimeout(r, 300));
  }
}

let stopRequested = false;
let releaseLock: () => Promise<void> = async () => {};
async function doStop(code: number): Promise<void> {
  stopRequested = true;
  console.log("\nStopping… (data is kept; `pnpm local:dev --fresh` starts empty)");
  for (const r of running.reverse()) {
    if (r.exited) continue;
    const exited = new Promise((resolve) => r.child.once("exit", resolve));
    const signal = (s: NodeJS.Signals) => {
      try {
        process.kill(-r.child.pid!, s);
      } catch {
        // already gone
      }
    };
    signal("SIGTERM");
    const timedOut = await Promise.race([
      exited.then(() => false),
      new Promise((resolve) => setTimeout(() => resolve(true), 10_000)),
    ]);
    if (timedOut) signal("SIGKILL");
  }
  await releaseLock().catch(() => undefined);
  // Everything of this run is stopped: nothing for the next start to clean (unless another run took the file).
  try {
    if (parsePidsFile(readFileSync(pidsFile, "utf8")).some((e) => e.pid === process.pid)) rmSync(pidsFile);
  } catch {
    // no file
  }
  process.exit(code);
}
const stop = makeStopper(doStop);
// SIGHUP: the Terminal window was closed.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => void stop(0));
// The script that started this one (`pnpm local:dev`, a shell) is gone: stop as well.
const startedBy = process.ppid;
setInterval(() => {
  if (process.ppid !== startedBy) void stop(0);
}, 1_000).unref();

/** ACC-01 FR 4: a fresh token in place of the account's live link (the letter itself stays in the API's memory). */
async function confirmationLinkFor(email: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(token, "utf8").digest();
  const { rowCount } = await withClient(devUrl, (c) =>
    c.query(
      `UPDATE identity.email_confirmations c SET token_digest = $1
         FROM identity.accounts a
        WHERE a.id = c.account_id AND a.email_normalized = lower($2)
          AND c.used_at IS NULL AND c.revoked_at IS NULL AND c.expires_at > now()`,
      [digest, email],
    ),
  );
  if (rowCount !== 1)
    throw new Error("no live confirmation link for this email (signed up? already confirmed?)");
  return confirmationLink(token, web);
}

try {
  releaseLock = await takeClusterLock();
  const created = await ensureDatabase();
  const password = randomBytes(24).toString("hex");
  await prepareDatabase(created, password);

  for (const role of ROLES) {
    const env = roleEnv({
      port: ports[role],
      webOrigin: web,
      databaseUrl: devUrl,
      password,
      modules,
      path: process.env["PATH"] ?? "",
    });
    const entry = start(role, [path.join(apiDir, "src/main.ts"), "--role", role], apiDir, env);
    await waitReady(`http://${LOCAL_HOST}:${ports[role]}/health/ready`, entry);
  }
  const webDir = path.join(repoDir, "apps/web");
  const vite = path.join(
    path.dirname(createRequire(path.join(webDir, "package.json")).resolve("vite/package.json")),
    "bin/vite.js",
  );
  const webEntry = start(
    "web",
    [vite, "--port", String(settings.webPort), "--strictPort"],
    webDir,
    webEnv(process.env, ports.api),
  );
  await waitReady(`${web}/v1/meta`, webEntry);
} catch (error) {
  console.error(`local:dev: ${(error as Error).message}`);
  await stop(1);
}

console.log(`
Willowsum is running: ${web}/#/signup  (open it in Chrome)
Logs: ${shown(logDir)}/{api,worker,scheduler,web}.log

Letters are not sent. Type the email you signed up with and press Enter to get its confirmation link.
Type «limits» to reset the sign-up limits. Ctrl+C stops everything; your data is kept.
`);

const rl = createInterface({ input: process.stdin });
rl.on("close", () => void stop(0));
for await (const line of rl) {
  const command = parsePrompt(line);
  try {
    if (command.kind === "confirm") console.log(await confirmationLinkFor(command.email));
    else if (command.kind === "limits") {
      await withClient(devUrl, (c) => c.query("DELETE FROM identity.throttle_events"));
      console.log("Sign-up limits cleared.");
    }
  } catch (error) {
    console.log(`Error: ${(error as Error).message}`);
  }
}
