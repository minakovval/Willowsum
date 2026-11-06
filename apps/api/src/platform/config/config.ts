import { z } from "zod";
import { schemaName } from "../modules/rules.ts";

/**
 * Process configuration (ARC-02 FR 3, CICD-12 FR 3): only environment variables (secrets are injected
 * into the environment by the pipeline from the secrets store), checked by a schema at start. With a
 * missing or invalid variable the process does not start, and the error names the variable — never its
 * value.
 */
export const ROLES = ["api", "worker", "scheduler"] as const;
export type Role = (typeof ROLES)[number];

export interface Config {
  readonly role: Role;
  /** HTTP port: the API itself for `api`, the health probes for every role. */
  readonly port: number;
  readonly shutdownTimeoutMs: number;
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly name: string;
    readonly ssl: boolean;
    /** Password of each module's login role `ws_mod_<schema>` (ARC-01). */
    readonly modulePasswords: ReadonlyMap<string, string>;
    /** Password of `ws_probe`, which may only read the applied-migrations list (readiness). */
    readonly probePassword: string;
    /** Password of `ws_context`, which may only bind module connections to a household (ARC-03). */
    readonly contextPassword: string;
  };
}

export class ConfigError extends Error {
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    super(`Configuration error: missing or invalid ${variables.join(", ")}`);
    this.name = "ConfigError";
    this.variables = variables;
  }
}

const secret = z.string().min(16);
const port = z.coerce.number().int().min(1).max(65_535);

export function modulePasswordVariable(module: string): string {
  return `WS_DB_PASSWORD_${schemaName(module).toUpperCase()}`;
}

/**
 * Reads the configuration of one process. `modules` are the declared modules (module-rules.json): each
 * needs the password of its database role.
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
  role: string,
  modules: readonly string[],
): Config {
  const shape = {
    WS_PORT: port.default(8080),
    WS_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    WS_DB_HOST: z.string().min(1),
    WS_DB_PORT: port.default(5432),
    WS_DB_NAME: z.string().regex(/^[a-z_][a-z0-9_]*$/),
    WS_DB_SSL: z.enum(["true", "false"]).default("true"),
    WS_DB_PROBE_PASSWORD: secret,
    WS_DB_CONTEXT_PASSWORD: secret,
    ...Object.fromEntries(modules.map((m) => [modulePasswordVariable(m), secret])),
  } satisfies z.ZodRawShape;
  const problems: string[] = [];
  if (!(ROLES as readonly string[]).includes(role)) problems.push("--role (api | worker | scheduler)");
  const parsed = z.object(shape).safeParse(env);
  if (!parsed.success) {
    // Only the variable names leave this function: zod messages could echo values.
    for (const issue of parsed.error.issues) problems.push(String(issue.path[0]));
  }
  if (problems.length > 0 || !parsed.success) throw new ConfigError([...new Set(problems)].sort());
  const v = parsed.data as Record<string, unknown>;
  return {
    role: role as Role,
    port: v["WS_PORT"] as number,
    shutdownTimeoutMs: v["WS_SHUTDOWN_TIMEOUT_MS"] as number,
    database: {
      host: v["WS_DB_HOST"] as string,
      port: v["WS_DB_PORT"] as number,
      name: v["WS_DB_NAME"] as string,
      ssl: v["WS_DB_SSL"] === "true",
      modulePasswords: new Map(modules.map((m) => [m, v[modulePasswordVariable(m)] as string])),
      probePassword: v["WS_DB_PROBE_PASSWORD"] as string,
      contextPassword: v["WS_DB_CONTEXT_PASSWORD"] as string,
    },
  };
}
