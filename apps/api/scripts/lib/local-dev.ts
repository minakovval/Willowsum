/**
 * Pure parts of `pnpm local:dev` (CICD-04@PoC: the local environment starts with one command): options, the
 * database name, the ports and environment of each process, the flags it turns on and the confirmation link.
 * The script itself is scripts/local-dev.ts.
 */
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
