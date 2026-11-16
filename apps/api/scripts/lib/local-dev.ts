/**
 * Pure parts of `pnpm local:dev` (CICD-04@PoC: the local environment starts with one command): options, the
 * database name, the ports and environment of each process, the flags it turns on and the confirmation link.
 * The script itself is scripts/local-dev.ts.
 */
import { createServer } from "node:net";
import type { FlagKind } from "../../src/modules/feature-flags/index.ts";
import { modulePasswordVariable } from "../../src/platform/config/config.ts";

/** The persistent development database on the `pnpm local:up` PostgreSQL; `--fresh` recreates it. */
export const DEV_DATABASE = "ws_dev";

/** The web app's dev server: the origin the API allows to write and puts in letter links. */
export const WEB_PORT = 5173;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

/** One process per role (ARC-02 FR 1); each listens on its own port (`/health/*`, and `/v1` for the API). */
export const ROLES = ["api", "worker", "scheduler"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_PORTS: Readonly<Record<Role, number>> = { api: 8080, worker: 8081, scheduler: 8082 };

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
  readonly role: Role;
  readonly databaseUrl: string;
  readonly password: string;
  readonly modules: readonly string[];
  readonly path: string;
}): Record<string, string> {
  const u = new URL(options.databaseUrl);
  return {
    PATH: options.path,
    WS_PORT: String(ROLE_PORTS[options.role]),
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
    WS_ALLOWED_ORIGINS: WEB_ORIGIN,
    WS_WEB_ORIGIN: WEB_ORIGIN,
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
export function confirmationLink(token: string): string {
  return `${WEB_ORIGIN}/#/verify?token=${encodeURIComponent(token)}`;
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
export function webEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return {
    PATH: env["PATH"] ?? "",
    HOME: env["HOME"] ?? "",
    WS_API_ORIGIN: `http://127.0.0.1:${ROLE_PORTS.api}`,
  };
}

/** The ports `pnpm local:dev` listens on: the three roles and the web dev server. */
export const LOCAL_DEV_PORTS: readonly number[] = [...Object.values(ROLE_PORTS), WEB_PORT];

/** True when nothing listens on the port (on every address, so a program bound to 0.0.0.0 or localhost counts). */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => resolve(error.code !== "EADDRINUSE"));
    probe.listen(port, () => probe.close(() => resolve(true)));
  });
}

/** The plain message for a busy port; empty when all are free. `free` is injectable for the test. */
export async function busyPortsMessage(
  ports: readonly number[] = LOCAL_DEV_PORTS,
  free: (port: number) => Promise<boolean> = isPortFree,
): Promise<string> {
  const lines: string[] = [];
  for (const port of ports) {
    if (!(await free(port))) {
      lines.push(
        `Port ${port} is in use by another program. Close it (an earlier \`pnpm local:dev\` still running in another terminal window?) and run again. ` +
          `On macOS \`lsof -nP -iTCP:${port} -sTCP:LISTEN\` shows which program it is.`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * One stop for the whole run: the first caller starts it, every later caller gets the same promise, so a failed
 * start that calls stop() while a stop is under way still waits for it and never goes on to «running».
 */
export function makeStopper(doStop: (code: number) => Promise<void>): (code: number) => Promise<void> {
  let stopping: Promise<void> | undefined;
  return (code) => (stopping ??= doStop(code));
}
