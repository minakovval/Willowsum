/**
 * Pure parts of `pnpm local:dev` (CICD-04@PoC: the local environment starts with one command): options, the
 * database name, the ports and environment of each process, the flags it turns on and the confirmation link.
 * The script itself is scripts/local-dev.ts.
 */
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import type { FlagKind } from "../../src/modules/feature-flags/index.ts";
import { modulePasswordVariable } from "../../src/platform/config/config.ts";

/** The persistent development database on the `pnpm local:up` PostgreSQL; `--fresh` recreates it. */
export const DEV_DATABASE = "ws_dev";

/** The web app's dev server: the origin the API allows to write and puts in letter links. */
export const WEB_PORT = 5173;
export const webOrigin = (port: number = WEB_PORT): string => `http://localhost:${port}`;
export const WEB_ORIGIN = webOrigin();

/**
 * One process per role (ARC-02 FR 1); each listens on its own port (`/health/*`, and `/v1` for the API). The
 * ports are picked free on every start (`pickRolePorts`): a fixed port may be held by another program, and on macOS
 * a program on 127.0.0.1 does not stop another one from listening on the same port of every address (#363).
 */
export const ROLES = ["api", "worker", "scheduler"] as const;
export type Role = (typeof ROLES)[number];
export type RolePorts = Readonly<Record<Role, number>>;

/** The role processes listen only on this machine's loopback address (`WS_HOST`), never on every interface. */
export const LOCAL_HOST = "127.0.0.1";

/**
 * Where one run keeps its database, logs and pids, and the web port. A person never sets these: only the
 * integration test of this script (test/local-dev.it.test.ts) does, so that it runs beside a real `pnpm local:dev`
 * on its own throwaway database (`ws_t_…`, the names of `pnpm db:test`), its own directory and a free web port.
 */
export interface LocalDevSettings {
  readonly database: string;
  readonly stateDir: string;
  readonly webPort: number;
}

export function localDevSettings(
  env: Readonly<Record<string, string | undefined>>,
  defaultStateDir: string,
): LocalDevSettings {
  const database = env["WS_LOCAL_DEV_DATABASE"] ?? DEV_DATABASE;
  if (database !== DEV_DATABASE && !/^ws_t_[a-z0-9_]{1,50}$/.test(database))
    throw new Error("WS_LOCAL_DEV_DATABASE: only a test database name (ws_t_…)");
  const stateDir = env["WS_LOCAL_DEV_STATE_DIR"] ?? defaultStateDir;
  if (!stateDir.startsWith("/")) throw new Error("WS_LOCAL_DEV_STATE_DIR: an absolute path");
  const webPort = Number(env["WS_LOCAL_DEV_WEB_PORT"] ?? WEB_PORT);
  if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535)
    throw new Error("WS_LOCAL_DEV_WEB_PORT: a port 1024–65535");
  return { database, stateDir, webPort };
}

export interface LocalDevOptions {
  /** Drop the development database first and start empty. */
  readonly fresh: boolean;
}

export const LOCAL_DEV_USAGE = "usage: pnpm local:dev [--fresh]";

export function parseLocalDevArgs(argv: readonly string[]): LocalDevOptions {
  let fresh = false;
  for (const arg of argv) {
    if (arg === "--fresh") fresh = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return { fresh };
}

/** The same server as `adminUrl` (a superuser URL), another database. */
export function databaseUrlFor(adminUrl: string, database: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${database}`;
  return u.toString();
}

/**
 * Environment of one role process: only what it needs (configuration comes only from the environment, ARC-02
 * FR 3), synthetic providers and in-process telemetry, so nothing leaves the machine (ARC-05, ARC-09).
 */
export function roleEnv(options: {
  readonly port: number;
  readonly webOrigin?: string;
  readonly databaseUrl: string;
  readonly password: string;
  readonly modules: readonly string[];
  readonly path: string;
}): Record<string, string> {
  const u = new URL(options.databaseUrl);
  const web = options.webOrigin ?? WEB_ORIGIN;
  return {
    PATH: options.path,
    WS_PORT: String(options.port),
    WS_HOST: LOCAL_HOST,
    WS_DB_HOST: u.hostname,
    WS_DB_PORT: u.port || "5432",
    WS_DB_NAME: u.pathname.slice(1),
    WS_DB_SSL: "false",
    WS_DB_PROBE_PASSWORD: options.password,
    WS_DB_CONTEXT_PASSWORD: options.password,
    ...Object.fromEntries(options.modules.map((m) => [modulePasswordVariable(m), options.password])),
    WS_PROVIDER_MODE: "test",
    WS_TELEMETRY: "test",
    WS_TELEMETRY_ENVIRONMENT: "local",
    WS_ALLOWED_ORIGINS: web,
    WS_WEB_ORIGIN: web,
  };
}

/** Every release flag (CICD-06): locally every function of the release is on. Operational flags keep their state. */
export function releaseFlagKeys(flags: Readonly<Record<string, { readonly kind: FlagKind }>>): string[] {
  return Object.entries(flags)
    .filter(([, flag]) => flag.kind === "release")
    .map(([key]) => key)
    .sort();
}

/** The link of the confirmation letter (ACC-01 FR 4), in the letter's own format. */
export function confirmationLink(token: string, origin: string = WEB_ORIGIN): string {
  return `${origin}/#/verify?token=${encodeURIComponent(token)}`;
}

/** What the person types at the prompt: an email (→ its confirmation link), `limits`, or nothing. */
export type PromptCommand =
  | { readonly kind: "confirm"; readonly email: string }
  | { readonly kind: "limits" }
  | { readonly kind: "none" };

export function parsePrompt(line: string): PromptCommand {
  const input = line.trim();
  if (!input) return { kind: "none" };
  if (input === "limits") return { kind: "limits" };
  return { kind: "confirm", email: input };
}

/** `pnpm local:dev` resets cluster-wide role passwords and may drop ws_dev: only a server on this machine. */
export function assertLocalServer(adminUrl: string): void {
  const refuse = (where: string): never => {
    throw new Error(`not a local PostgreSQL (${where}); pnpm local:dev runs only on this machine`);
  };
  // pg parses a URL with a leading space differently (host `base`): refuse it before reading anything.
  if (adminUrl !== adminUrl.trim()) refuse("the URL has leading or trailing spaces");
  const u = new URL(adminUrl);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const params = new URLSearchParams(u.search);
  const socket = params.get("host") ?? "";
  if (host !== "") {
    // libpq lets ?host= / ?hostaddr= override the authority: with either present the real target is not `host`.
    if (params.has("host") || params.has("hostaddr")) refuse(`${host} with ${socket || "hostaddr"}`);
    if (!["127.0.0.1", "::1", "localhost"].includes(host)) refuse(host);
    return;
  }
  // pg uses the last value of a repeated parameter, so more than one is never accepted.
  if (params.getAll("host").length > 1) refuse("host given more than once");
  if (params.getAll("hostaddr").length > 1) refuse("hostaddr given more than once");
  if (params.has("hostaddr") || !socket.startsWith("/") || socket.includes(",")) refuse(socket || "no host");
}

/** Environment of the web dev server: only what Vite needs and the API address, not the whole process.env. */
export function webEnv(
  env: Readonly<Record<string, string | undefined>>,
  apiPort: number,
): Record<string, string> {
  return {
    PATH: env["PATH"] ?? "",
    HOME: env["HOME"] ?? "",
    WS_API_ORIGIN: `http://${LOCAL_HOST}:${apiPort}`,
  };
}

/**
 * The addresses a port is tried on. On macOS a listener on 127.0.0.1 (or ::1) does not stop another one on the
 * same port of every address, so each is tried on its own (#363: an ssh port forward on 127.0.0.1:8082).
 */
const PROBE_HOSTS = [LOCAL_HOST, "::1", "0.0.0.0", "::"] as const;

function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    // No IPv6 on this machine (EADDRNOTAVAIL, EAFNOSUPPORT): nothing can listen there either.
    probe.once("error", (error: NodeJS.ErrnoException) => resolve(error.code !== "EADDRINUSE"));
    probe.listen({ port, host, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}

/** True when nothing listens on the port: not on 127.0.0.1, not on ::1, not on every address. */
export async function isPortFree(port: number): Promise<boolean> {
  for (const host of PROBE_HOSTS) if (!(await canListen(port, host))) return false;
  return true;
}

/** A port the system gives out right now on 127.0.0.1 (it may still be held on another address). */
export function ephemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen({ port: 0, host: LOCAL_HOST, exclusive: true }, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/** Free ports for the three roles: distinct, not the web port, free on every address. Injectable for the test. */
export async function pickRolePorts(
  webPort: number = WEB_PORT,
  free: (port: number) => Promise<boolean> = isPortFree,
  candidate: () => Promise<number> = ephemeralPort,
): Promise<RolePorts> {
  const taken = new Set<number>([webPort]);
  const ports: Partial<Record<Role, number>> = {};
  for (const role of ROLES) {
    for (let attempt = 0; ports[role] === undefined; attempt++) {
      if (attempt === 50) throw new Error("не вдалося знайти вільний порт на 127.0.0.1");
      const port = await candidate();
      if (!taken.has(port) && (await free(port))) {
        ports[role] = port;
        taken.add(port);
      }
    }
  }
  return ports as RolePorts;
}

/** The plain message for a busy web port (the browser opens it, so it stays fixed); empty when it is free. */
export async function busyPortsMessage(
  ports: readonly number[] = [WEB_PORT],
  free: (port: number) => Promise<boolean> = isPortFree,
): Promise<string> {
  const lines: string[] = [];
  for (const port of ports) {
    if (!(await free(port))) {
      lines.push(
        `Порт ${port} зайнятий іншою програмою. Закрийте її (можливо, \`pnpm local:dev\` з іншої копії репозиторію ще працює в сусідньому вікні) і запустіть знову. ` +
          `На macOS \`lsof -nP -iTCP:${port} -sTCP:LISTEN\` покаже, що це за програма.`,
      );
    }
  }
  return lines.join("\n");
}

/** The last `count` non-empty lines of a log. */
export function lastLines(text: string, count = 20): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(-count)
    .join("\n");
}

/** The last answer of a readiness probe, if any came. */
export interface ProbeAnswer {
  readonly status: number;
  readonly body: string;
}

/** Why a process was not ready in time: the last answer of `/health/ready` (and its reason) and its log's end. */
export function readinessTimeoutMessage(options: {
  readonly name: string;
  readonly seconds: number;
  readonly url: string;
  readonly answer: ProbeAnswer | undefined;
  readonly log: string;
  readonly logTail: string;
}): string {
  const { name, seconds, url, answer, log, logTail } = options;
  let reason = "";
  if (answer) {
    try {
      const parsed = JSON.parse(answer.body) as { reason?: unknown };
      if (typeof parsed.reason === "string") reason = parsed.reason.replace(/[^\w.:-]/g, "").slice(0, 100);
    } catch {
      // not JSON: not our server answered
    }
  }
  const probe = answer
    ? `Остання відповідь ${url}: HTTP ${answer.status}${reason ? `, причина «${reason}»` : ""}.`
    : `${url} жодного разу не відповів.`;
  return (
    `${name} не став готовим за ${seconds} с. ${probe}\n` +
    (logTail ? `Останні рядки ${log}:\n${logTail}` : `Журнал ${log} порожній.`)
  );
}

/**
 * The processes of one run, kept in `infra/local/.state/dev/pids.json` so that the next start stops what an earlier
 * one left behind. `identity` is what `ps` printed for the pid right after the start (start time and command line):
 * a pid the system later gave to another program never matches, so it is never stopped.
 */
export interface PidEntry {
  readonly name: string;
  readonly pid: number;
  readonly identity: string;
}

/** The name of the controlling script's own entry: it is stopped first, then its children. */
export const PARENT_ENTRY = "local-dev";

export function parsePidsFile(text: string): PidEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.filter(
    (e): e is PidEntry =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as PidEntry).name === "string" &&
      Number.isSafeInteger((e as PidEntry).pid) &&
      (e as PidEntry).pid > 1 &&
      typeof (e as PidEntry).identity === "string" &&
      (e as PidEntry).identity.trim() !== "",
  );
}

/** Start time and command line of a live process (`ps`, the same on macOS and Linux); undefined when it is gone. */
export function processIdentity(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 1) return undefined;
  const res = spawnSync("ps", ["-ww", "-o", "lstart=", "-o", "command=", "-p", String(pid)], {
    encoding: "utf8",
  });
  const out = res.status === 0 ? res.stdout.trim() : "";
  return out === "" ? undefined : out;
}

/** What `cleanLeftovers` needs from the system; injectable for the test. */
export interface ProcessControl {
  readonly identityOf: (pid: number) => string | undefined;
  /** `target` < 0 is a process group. */
  readonly kill: (target: number, signal: NodeJS.Signals) => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (message: string) => void;
}

export const systemProcessControl: ProcessControl = {
  identityOf: processIdentity,
  kill: (target, signal) => {
    try {
      process.kill(target, signal);
    } catch {
      // already gone
    }
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (message) => console.log(message),
};

/**
 * Stops the processes of an earlier run that are still ours (same pid, same start time and command line): the
 * earlier script first (it stops its own children and releases the cluster lock), then any child left behind
 * (its process group: each child was started as a group leader). Returns the entries it stopped.
 */
export async function cleanLeftovers(
  entries: readonly PidEntry[],
  control: ProcessControl = systemProcessControl,
  graceMs = 15_000,
): Promise<PidEntry[]> {
  const ours = (e: PidEntry) => e.pid !== process.pid && control.identityOf(e.pid) === e.identity;
  const alive = entries.filter(ours);
  if (alive.length === 0) return [];
  control.log(
    `Зупиняю те, що лишилося від попереднього \`pnpm local:dev\`: ${alive.map((e) => `${e.name} (pid ${e.pid})`).join(", ")}.`,
  );
  const waitGone = async (list: readonly PidEntry[]) => {
    for (let waited = 0; waited < graceMs && list.some(ours); waited += 250) await control.sleep(250);
  };
  const parents = alive.filter((e) => e.name === PARENT_ENTRY);
  for (const e of parents) control.kill(e.pid, "SIGTERM");
  await waitGone(parents);
  for (const e of parents.filter(ours)) control.kill(e.pid, "SIGKILL");
  const children = alive.filter((e) => e.name !== PARENT_ENTRY && ours(e));
  for (const e of children) control.kill(-e.pid, "SIGTERM");
  await waitGone(children);
  for (const e of children.filter(ours)) control.kill(-e.pid, "SIGKILL");
  return alive;
}

/** application_name of the lock session of `pnpm local:dev`, with the pid of the script that holds it. */
export const LOCAL_DEV_APPLICATION = "ws-local-dev";
export const localDevApplicationName = (pid: number = process.pid): string =>
  `${LOCAL_DEV_APPLICATION} ${pid}`;

/**
 * Who holds the cluster lock (tools/test-guards/cluster-lock.mjs) now: the session's pid and application_name.
 * $1: LOCK_NAME, $2: LOCK_DATABASE. Same key formula as HELD_BY_SQL.
 */
export const LOCK_HOLDER_SQL = `SELECT a.pid, a.application_name FROM pg_locks l
  JOIN pg_database d ON d.oid = l.database JOIN pg_stat_activity a ON a.pid = l.pid
  WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 1 AND d.datname = $2
    AND ((l.classid::bigint << 32) | l.objid::bigint) = hashtext($1)::bigint`;

export interface LockHolder {
  /** Backend pid of the PostgreSQL session. */
  readonly pid: number;
  readonly applicationName: string;
}

/** What the person reads while this run waits for the cluster lock: who holds it and what to do. */
export function lockHolderMessage(holder: LockHolder | undefined): string {
  if (!holder) return "Чекаю на блокування кластера PostgreSQL…";
  const name = holder.applicationName.replace(/[^\w .:-]/g, "").slice(0, 63) || "без назви";
  const devRun = new RegExp(`^${LOCAL_DEV_APPLICATION}(?: (\\d+))?$`).exec(name);
  if (devRun) {
    const pid = devRun[1] ? ` (pid ${devRun[1]})` : "";
    return (
      `Кластер PostgreSQL зайнятий: інший \`pnpm local:dev\`${pid} у сусідньому вікні — закрийте його (Ctrl+C у тому вікні). ` +
      "Цей запуск продовжиться сам, щойно той зупиниться."
    );
  }
  if (name === "ws-integration-lock" || name === "psql")
    return (
      `Кластер PostgreSQL зайнятий: йдуть інтеграційні тести (сеанс «${name}», pid сервера ${holder.pid}). ` +
      "Цей запуск продовжиться сам, щойно вони закінчаться."
    );
  return (
    `Кластер PostgreSQL зайнятий сеансом «${name}» (pid сервера ${holder.pid}). ` +
    "Цей запуск продовжиться сам, щойно сеанс відпустить блокування."
  );
}

/**
 * One stop for the whole run: the first caller starts it, every later caller gets the same promise, so a failed
 * start that calls stop() while a stop is under way still waits for it and never goes on to «running».
 */
export function makeStopper(doStop: (code: number) => Promise<void>): (code: number) => Promise<void> {
  let stopping: Promise<void> | undefined;
  return (code) => (stopping ??= doStop(code));
}
