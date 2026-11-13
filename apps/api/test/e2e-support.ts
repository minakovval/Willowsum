/**
 * The API side of the browser end-to-end tests (NFR-07@PoC; apps/web/e2e). The real API process
 * (`node src/main.ts --role api`, ARC-02) on a throw-away database prepared the way the local environment documents
 * it (apps/api/README.md): `db:bootstrap`, then the migrations, then a login for every module role. Synthetic
 * providers only (`WS_PROVIDER_MODE=test`: synthetic CAPTCHA and mail, no network). Passwords are random per run
 * and never printed.
 *
 * The synthetic mail adapter keeps letters in the API process's memory, out of the browser's reach. A test that
 * needs the confirmation letter's link mints it the way the letter would carry it: it replaces the digest of the
 * account's live link with the digest of a token it made (`confirmationLinkFor`). Nothing in the API changes for
 * the tests.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import pg from "pg";
import { modulePasswordVariable } from "../src/platform/config/config.ts";
import {
  bootstrapDatabase,
  enableContextLogin,
  enableModuleLogin,
  enableProbeLogin,
} from "../src/platform/db/migrate.ts";
import { createTestDatabase } from "./db.ts";
import { apiDir, migrateRealModules, realModules } from "./real-modules.ts";

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function waitFor(url: string, timeoutMs: number, exited: () => string | null): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    const failed = exited();
    if (failed !== null) throw new Error(`the API process stopped before it was ready:\n${failed}`);
    try {
      if ((await fetch(url)).status === 200) return;
    } catch {
      // not listening yet
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`${url} was not ready within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

export interface E2eApi {
  /** `http://127.0.0.1:<port>`: the web app's dev or preview server passes `/v1` here (`WS_API_ORIGIN`). */
  readonly origin: string;
  /** Superuser URL of the throw-away database, for test seeding only. */
  readonly databaseUrl: string;
  stop(): Promise<void>;
}

/**
 * A fresh database (on the server of `DATABASE_URL`, a superuser URL) and the API process on a free port, ready.
 * `webOrigin` is the web app's origin: the only one allowed to write (NFR-15 FR 5) and the base of letter links.
 */
export async function startE2eApi(webOrigin: string): Promise<E2eApi> {
  const db = await createTestDatabase();
  const password = randomBytes(24).toString("hex");
  const owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  try {
    await bootstrapDatabase(owner);
    await migrateRealModules(owner, db.url);
    for (const module of realModules) await enableModuleLogin(owner, module, password);
    await enableContextLogin(owner, password);
    await enableProbeLogin(owner, password);
    // ACC-01: sign-up and sign-in are behind the release flag `identity.sign-in` (stage «all»), off by default.
    await owner.query(
      `INSERT INTO feature_flags.flags (key, stage, percent, fully_enabled_at) VALUES ('identity.sign-in', 'all', 100, now())
       ON CONFLICT (key) DO UPDATE SET stage = 'all', percent = 100, fully_enabled_at = now()`,
    );
  } catch (error) {
    await owner.end();
    await db.drop();
    throw error;
  }
  await owner.end();

  const port = await freePort();
  const u = new URL(db.url);
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    WS_PORT: String(port),
    WS_DB_HOST: u.hostname,
    WS_DB_PORT: u.port || "5432",
    WS_DB_NAME: u.pathname.slice(1),
    WS_DB_SSL: "false",
    WS_DB_PROBE_PASSWORD: password,
    WS_DB_CONTEXT_PASSWORD: password,
    ...Object.fromEntries(realModules.map((m) => [modulePasswordVariable(m), password])),
    WS_PROVIDER_MODE: "test",
    WS_TELEMETRY: "test",
    WS_TELEMETRY_ENVIRONMENT: "ci",
    WS_ALLOWED_ORIGINS: webOrigin,
    WS_WEB_ORIGIN: webOrigin,
  };
  const child: ChildProcess = spawn(process.execPath, ["src/main.ts", "--role", "api"], {
    cwd: apiDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let exit: number | null | undefined;
  child.stdout!.on("data", (d) => (output += d));
  child.stderr!.on("data", (d) => (output += d));
  const exited = new Promise<void>((resolve) =>
    child.on("exit", (code) => {
      exit = code;
      resolve();
    }),
  );
  const origin = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (exit === undefined) {
      child.kill("SIGTERM");
      await exited;
    }
    await db.drop();
  };
  try {
    await waitFor(`${origin}/health/ready`, 30_000, () => (exit === undefined ? null : output));
  } catch (error) {
    await stop();
    throw error;
  }
  return { origin, databaseUrl: db.url, stop };
}

async function withOwner<T>(databaseUrl: string, fn: (owner: pg.Client) => Promise<T>): Promise<T> {
  const owner = new pg.Client({ connectionString: databaseUrl });
  await owner.connect();
  try {
    return await fn(owner);
  } finally {
    await owner.end();
  }
}

/**
 * The link of the account's confirmation letter (ACC-01 FR 4): a fresh token in place of the live link's digest, in
 * the letter's own format (`<web origin>/#/verify?token=…`). Fails when the account has no live link.
 */
export async function confirmationLinkFor(
  databaseUrl: string,
  email: string,
  webOrigin: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(token, "utf8").digest();
  const { rowCount } = await withOwner(databaseUrl, (owner) =>
    owner.query(
      `UPDATE identity.email_confirmations c SET token_digest = $1
         FROM identity.accounts a
        WHERE a.id = c.account_id AND a.email_normalized = lower($2)
          AND c.used_at IS NULL AND c.revoked_at IS NULL AND c.expires_at > now()`,
      [digest, email],
    ),
  );
  if (rowCount !== 1) throw new Error(`expected one live confirmation link, found ${rowCount}`);
  return `${webOrigin}/#/verify?token=${encodeURIComponent(token)}`;
}

/**
 * Every test signs up from the same client address (the web server's proxy): the sign-up limit of 5 per hour and
 * address and the letter limit (one per 60 s, ACC-01 FR 15) would stop the run, not the behaviour under test. Clears
 * every counter of this test database.
 */
export async function clearSignUpLimits(databaseUrl: string): Promise<void> {
  await withOwner(databaseUrl, (owner) => owner.query(`DELETE FROM identity.throttle_events`));
}

/** The spaces the account belongs to, with its role there (ACC-01 FR 7: the first sign-in creates «Родина <Прізвище>»). */
export async function spacesOf(
  databaseUrl: string,
  email: string,
): Promise<{ readonly name: string; readonly role: string }[]> {
  const { rows } = await withOwner(databaseUrl, (owner) =>
    owner.query<{ name: string; role: string }>(
      `SELECT h.name, s.role
         FROM household.account_spaces s
         JOIN household.households h ON h.household_id = s.space_id
         JOIN identity.accounts a ON a.id = s.account_id
        WHERE a.email_normalized = lower($1)
        ORDER BY h.name`,
      [email],
    ),
  );
  return rows;
}
