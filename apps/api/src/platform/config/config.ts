import { z } from "zod";
import { PROVIDER_MODES, type ProviderMode } from "../adapters/port.ts";
import { LOCAL_ALLOWED_ORIGINS, parseAllowedOrigins } from "../http/origin.ts";
import { schemaName } from "../modules/rules.ts";
import { TELEMETRY_MODES, type TelemetryMode } from "../telemetry/modes.ts";

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
  /** Source of the plan matrix (plan-catalog); PoC: every feature enabled (П-24). */
  readonly planEntitlements: (typeof PLAN_ENTITLEMENT_SOURCES)[number];
  /**
   * Which implementation of every provider port runs (ARC-05 FR 2, ADR-0005): `test` (synthetic, no network;
   * the default, so local development and CI never reach a provider) or `live` (deployed environments).
   */
  readonly providerMode: ProviderMode;
  /**
   * Telemetry (ARC-09, ADR-0006): `test` (the default, local development and CI — kept in memory, nothing
   * leaves the process), `otlp` (export over OTLP/HTTP to the endpoint; from MVP) or `off` (no export:
   * structured log lines on standard output, trace ids still made; the PoC in production, owner's decision of
   * 2026-11-12). Replacing the service or turning export on is a change of these variables only.
   */
  readonly telemetry: {
    readonly mode: TelemetryMode;
    /** `deployment.environment.name` of every signal (`local`, `ci`, `staging`, `production`). */
    readonly environment: string;
    /** Only with mode `otlp`. */
    readonly otlp?: {
      /** Base URL; signals go to `<endpoint>/v1/traces`, `/v1/metrics`, `/v1/logs`. */
      readonly endpoint: string;
      /** Value of the `Authorization` header (secret). */
      readonly authorization: string;
    };
  };
  /**
   * Staging or production (`WS_TELEMETRY_ENVIRONMENT`): served over HTTPS only, so HSTS is sent and session
   * cookies are `__Secure-` (NFR-14, NFR-15 FR 5).
   */
  readonly deployed: boolean;
  /** HTTP protections of the API (NFR-14, NFR-15 FR 5; ADR-0007). */
  readonly http: {
    /** Proxies in front of the API whose forwarded headers are trusted (`WS_TRUSTED_PROXY_HOPS`, default 0). */
    readonly trustedProxyHops: number;
    /** `on` (default everywhere) or `off-load-test` (a load test only; refused in production). */
    readonly rateLimits: (typeof RATE_LIMIT_MODES)[number];
    /** Origins whose pages may send write requests (`WS_ALLOWED_ORIGINS`; default below in loadConfig). */
    readonly allowedOrigins: ReadonlySet<string>;
  };
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

/** `WS_RATE_LIMITS`: on, or off only for a load test (NFR-14 FR 9). */
export const RATE_LIMIT_MODES = ["on", "off-load-test"] as const;

/**
 * API instances that may run with rate-limit counters in process memory (NFR-14 FR 10): one. With more
 * (`WS_API_INSTANCES` > 1) and limits on, the process refuses to start until a shared store exists (ADR-0007).
 */
export const MAX_INSTANCES_WITH_MEMORY_RATE_LIMITS = 1;

/** Mirrors plan-catalog's ENTITLEMENT_SOURCES (a test keeps them equal; platform code cannot import modules). */
export const PLAN_ENTITLEMENT_SOURCES = ["all-enabled"] as const;

const secret = z.string().min(16);
const port = z.coerce.number().int().min(1).max(65_535);

/** Environments where telemetry must be set explicitly and may not be `test` (in memory). */
export const DEPLOYED_ENVIRONMENTS: ReadonlySet<string> = new Set(["staging", "production"]);

/** https, or http only for a collector on this machine; no credentials, query or fragment in the URL. */
export function isTelemetryEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return (
    (url.protocol === "https:" || (url.protocol === "http:" && local)) &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "" &&
    // A bare «?» or «#» leaves search and hash empty but would break the signal paths appended to the URL.
    !value.includes("?") &&
    !value.includes("#")
  );
}

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
    WS_PLAN_ENTITLEMENTS: z.enum(PLAN_ENTITLEMENT_SOURCES).default("all-enabled"),
    WS_PROVIDER_MODE: z.enum(PROVIDER_MODES).default("test"),
    WS_TELEMETRY: z.enum(TELEMETRY_MODES).optional(),
    WS_TELEMETRY_ENVIRONMENT: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,31}$/)
      .default("local"),
    WS_OTLP_ENDPOINT: z.string().refine(isTelemetryEndpoint).optional(),
    WS_OTLP_AUTHORIZATION: secret.optional(),
    WS_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    WS_RATE_LIMITS: z.enum(RATE_LIMIT_MODES).default("on"),
    WS_API_INSTANCES: z.coerce.number().int().min(1).max(64).default(1),
    WS_ALLOWED_ORIGINS: z
      .string()
      .refine((v) => parseAllowedOrigins(v) !== undefined)
      .optional(),
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
  // A deployed environment must choose its telemetry explicitly and may not keep it in memory: a forgotten
  // WS_TELEMETRY there would silently lose every signal. `otlp` exports; `off` (the PoC, owner 2026-11-12)
  // keeps the structured logs on the server without export. Elsewhere the default stays `test`.
  if (
    parsed.success &&
    DEPLOYED_ENVIRONMENTS.has(parsed.data.WS_TELEMETRY_ENVIRONMENT) &&
    (parsed.data.WS_TELEMETRY ?? "test") === "test"
  )
    problems.push("WS_TELEMETRY");
  // The exporter's endpoint and its secret header are required only when telemetry is exported.
  if (parsed.success && parsed.data.WS_TELEMETRY === "otlp") {
    if (parsed.data.WS_OTLP_ENDPOINT === undefined) problems.push("WS_OTLP_ENDPOINT");
    if (parsed.data.WS_OTLP_AUTHORIZATION === undefined) problems.push("WS_OTLP_AUTHORIZATION");
  }
  if (parsed.success) {
    const deployed = DEPLOYED_ENVIRONMENTS.has(parsed.data.WS_TELEMETRY_ENVIRONMENT);
    // NFR-14 FR 9: limits can be switched off only for a load test, which never runs in production.
    if (parsed.data.WS_RATE_LIMITS !== "on" && parsed.data.WS_TELEMETRY_ENVIRONMENT === "production")
      problems.push("WS_RATE_LIMITS");
    // NFR-14 FR 10: counters live in process memory; more API instances need a shared store first.
    if (
      role === "api" &&
      parsed.data.WS_RATE_LIMITS === "on" &&
      parsed.data.WS_API_INSTANCES > MAX_INSTANCES_WITH_MEMORY_RATE_LIMITS
    )
      problems.push("WS_API_INSTANCES");
    // NFR-15 FR 5: staging and production take HTTPS origins only (http only for this machine, locally).
    if (
      deployed &&
      [...(parseAllowedOrigins(parsed.data.WS_ALLOWED_ORIGINS ?? "") ?? [])].some(
        (o) => !o.startsWith("https://"),
      )
    )
      problems.push("WS_ALLOWED_ORIGINS");
  }
  if (problems.length > 0 || !parsed.success) throw new ConfigError([...new Set(problems)].sort());
  const v = parsed.data as Record<string, unknown>;
  const telemetryMode = (v["WS_TELEMETRY"] ?? "test") as TelemetryMode;
  return {
    role: role as Role,
    port: v["WS_PORT"] as number,
    shutdownTimeoutMs: v["WS_SHUTDOWN_TIMEOUT_MS"] as number,
    planEntitlements: v["WS_PLAN_ENTITLEMENTS"] as Config["planEntitlements"],
    providerMode: v["WS_PROVIDER_MODE"] as ProviderMode,
    telemetry: {
      mode: telemetryMode,
      environment: v["WS_TELEMETRY_ENVIRONMENT"] as string,
      ...(telemetryMode === "otlp"
        ? {
            otlp: {
              endpoint: v["WS_OTLP_ENDPOINT"] as string,
              authorization: v["WS_OTLP_AUTHORIZATION"] as string,
            },
          }
        : {}),
    },
    deployed: DEPLOYED_ENVIRONMENTS.has(v["WS_TELEMETRY_ENVIRONMENT"] as string),
    http: {
      trustedProxyHops: v["WS_TRUSTED_PROXY_HOPS"] as number,
      rateLimits: v["WS_RATE_LIMITS"] as Config["http"]["rateLimits"],
      // Not set: the Vite dev and preview servers locally; none in staging and production, where every
      // write from a browser page is then refused (fail closed) until the web app's origin is configured.
      allowedOrigins:
        v["WS_ALLOWED_ORIGINS"] !== undefined
          ? parseAllowedOrigins(v["WS_ALLOWED_ORIGINS"] as string)!
          : DEPLOYED_ENVIRONMENTS.has(v["WS_TELEMETRY_ENVIRONMENT"] as string)
            ? new Set<string>()
            : LOCAL_ALLOWED_ORIGINS,
    },
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
