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
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import pg from "pg";
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
  DEV_DATABASE,
  LOCAL_DEV_USAGE,
  ROLES,
  ROLE_PORTS,
  WEB_ORIGIN,
  WEB_PORT,
  assertLocalServer,
  busyPortsMessage,
  confirmationLink,
  databaseUrlFor,
  makeStopper,
  parseLocalDevArgs,
  parsePrompt,
  releaseFlagKeys,
  roleEnv,
  type LocalDevOptions,
} from "./lib/local-dev.ts";

const apiDir = fileURLToPath(new URL("..", import.meta.url));
const repoDir = path.resolve(apiDir, "../..");
const logDir = path.join(repoDir, "infra/local/.state/dev");

let options: LocalDevOptions;
try {
  options = parseLocalDevArgs(process.argv.slice(2));
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

const busy = await busyPortsMessage();
if (busy) {
  console.error(busy);
  process.exit(2);
}

const modules = topologicalOrder(
  JSON.parse(readFileSync(path.join(apiDir, "module-rules.json"), "utf8")) as ModuleRules,
);
const devUrl = databaseUrlFor(adminUrl, DEV_DATABASE);

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
  return withClient(adminUrl!, async (admin) => {
    if (options.fresh) await admin.query(`DROP DATABASE IF EXISTS ${DEV_DATABASE} WITH (FORCE)`);
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DEV_DATABASE]);
    if (rowCount === 1) return false;
    await admin.query(`CREATE DATABASE ${DEV_DATABASE}`);
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

interface Running {
  readonly name: string;
  readonly child: ChildProcess;
  readonly log: string;
  exited: boolean;
}
const running: Running[] = [];

function start(name: string, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Running {
  mkdirSync(logDir, { recursive: true, mode: 0o700 });
  const log = path.join(logDir, `${name}.log`);
  const out = createWriteStream(log, { mode: 0o600 });
  // Own process group: Ctrl+C reaches only this script, which stops the children in order.
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout!.pipe(out);
  child.stderr!.pipe(out);
  const entry: Running = { name, child, log, exited: false };
  child.on("exit", (code) => {
    entry.exited = true;
    if (!stopRequested) {
      console.error(`\n${name} stopped (exit ${code}); see ${path.relative(repoDir, log)}`);
      void stop(1);
    }
  });
  running.push(entry);
  return entry;
}

async function waitReady(url: string, entry: Running, timeoutMs = 60_000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (entry.exited) throw new Error(`${entry.name} stopped before it was ready`);
    try {
      if ((await fetch(url)).status === 200) return;
    } catch {
      // not listening yet
    }
    if (Date.now() - t0 > timeoutMs)
      throw new Error(`${entry.name} was not ready within ${timeoutMs / 1000} s`);
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
    try {
      process.kill(-r.child.pid!, "SIGTERM");
    } catch {
      // already gone
    }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  }
  await releaseLock().catch(() => undefined);
  process.exit(code);
}
const stop = makeStopper(doStop);
process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));

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
  return confirmationLink(token);
}

try {
  releaseLock = await acquireClusterLock({
    databaseUrl: adminUrl,
    holderPid: undefined,
    applicationName: "ws-local-dev",
    log: () => console.log("Waiting for another local run / tests to finish…"),
  });
  const created = await ensureDatabase();
  const password = randomBytes(24).toString("hex");
  await prepareDatabase(created, password);

  for (const role of ROLES) {
    const env = roleEnv({ role, databaseUrl: devUrl, password, modules, path: process.env["PATH"] ?? "" });
    const entry = start(role, process.execPath, ["src/main.ts", "--role", role], apiDir, env);
    await waitReady(`http://127.0.0.1:${ROLE_PORTS[role]}/health/ready`, entry);
  }
  const web = start(
    "web",
    "pnpm",
    ["exec", "vite", "--port", String(WEB_PORT), "--strictPort"],
    path.join(repoDir, "apps/web"),
    {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "",
      WS_API_ORIGIN: `http://127.0.0.1:${ROLE_PORTS.api}`,
    },
  );
  await waitReady(`${WEB_ORIGIN}/v1/meta`, web);
} catch (error) {
  console.error(`local:dev: ${(error as Error).message}`);
  await stop(1);
}

console.log(`
Willowsum is running: ${WEB_ORIGIN}/#/signup  (open it in Chrome)
Logs: ${path.relative(repoDir, logDir)}/{api,worker,scheduler,web}.log

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
