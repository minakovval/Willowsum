import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { ProviderError } from "../adapters/errors.ts";
import { databaseErrorFields, type DatabaseErrorFields } from "../db/errors.ts";
import { markRequestProblem, markUnavailableReason } from "../telemetry/http.ts";
import { recordRateLimitRejection } from "../telemetry/signals.ts";
import type { HouseholdQueryRunner, ModuleDatabase, ModuleQueryRunner } from "../db/module-db.ts";
import {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_RE,
  IDEMPOTENCY_REPLAYED_HEADER,
  requestHash,
  type IdempotencyStore,
} from "./idempotency.ts";
import { cookieContext, readSessionCookie } from "./cookies.ts";
import { originAllowed } from "./origin.ts";
import {
  ApiProblem,
  PROBLEM_CONTENT_TYPE,
  problemBody,
  type ProblemCode,
  type ProblemExtensions,
  type ProblemFieldError,
} from "./problem.ts";
import {
  clientAddressKey,
  createApiRateLimits,
  RateLimited,
  type ApiRateLimits,
  type RateLimitClass,
} from "./rate-limit.ts";
import {
  API_PREFIX,
  fastifyPath,
  isPublic,
  routeFlags,
  routeRateLimitClass,
  type ApiRoute,
  type HouseholdFreeDatabase,
  type Principal,
  type ProtectedContext,
  type PublicContext,
  type RouteHttp,
  type RouteInput,
} from "./route.ts";

/**
 * The one HTTP API of every client (ARC-07 FR 1, NFR-05 FR 1–2). For each request, in this order:
 * the rate limit of the client's address (429 RATE_LIMITED, NFR-14) → the Origin of a write (403
 * ORIGIN_NOT_ALLOWED, NFR-15 FR 5) → the module's kill switch (feature-flags, 503 MODULE_UNAVAILABLE) →
 * authentication (401) → the route's flag for the caller's space (feature-flags, 404 as for a route that
 * does not exist) → role and scope (access-scope, 403) → plan (plan-catalog, 402) → input validation with
 * the route's zod schemas (400) → idempotency for create routes (409 / replay) → handler → the response
 * parsed by the route's response schema (fields not in the contract never leave the server). Public
 * platform routes have no module, flag or session: rate limit, Origin, validation and the handler. A public
 * route of a module (sign-up and sign-in, ACC-01) has no session either: after the rate limit and the Origin, its
 * module's kill switch (503) and its flag for everyone (404, `checkFlagForAll`), all before the body is read.
 */
export interface ApiOptions {
  readonly routes: readonly ApiRoute[];
  /** The session of the request (identity, ACC-01). Null: not signed in. */
  readonly authenticate: (request: FastifyRequest) => Promise<Principal | null>;
  /** Role and scope check (access-scope). */
  readonly checkPermission: (principal: Principal, permission: string) => boolean;
  /** Plan check by feature key (plan-catalog). */
  readonly checkFeature: (principal: Principal, feature: string) => Promise<boolean>;
  /** Is the module available, i.e. its kill switch off (feature-flags, CICD-06 FR 3)? */
  readonly moduleAvailable: (module: string) => Promise<boolean>;
  /**
   * Why a module is unavailable, when known (feature-flags `moduleState`): `killed` — its kill switch, a
   * deliberate action; `unknown` — no usable flag state (a failing database). Both answer 503
   * MODULE_UNAVAILABLE; only `killed` is left out of the 5xx ratio, `unknown` is reported as the server error
   * `FlagStateUnavailable` (ARC-09, ADR-0006). Without it, an unavailable module counts as `unknown` (an
   * outage): only a caller that knows the reason may claim a deliberate switch.
   */
  readonly moduleState?: (module: string) => Promise<"on" | "killed" | "unknown">;
  /** Is the flag on for the caller's space (feature-flags, CICD-06 FR 1)? */
  readonly checkFlag: (principal: Principal, flag: string) => Promise<boolean>;
  /**
   * Is the flag on for everyone (feature-flags: rollout «all»)? Public routes of a module have no space to
   * evaluate a share or a test space for. Omitted: off, so such routes answer 404.
   */
  readonly checkFlagForAll?: (flag: string) => Promise<boolean>;
  /** What a module's public routes get as `ctx.services` (its ports and settings, src/api.ts). */
  readonly services?: (module: string) => unknown;
  /** The app is served over HTTPS only (staging, production): session cookies are always `__Secure-`. */
  readonly secureCookies?: boolean;
  /** Every permission, feature key and flag that exists; a route naming another one is refused at start. */
  readonly permissions: ReadonlySet<string>;
  readonly features: ReadonlySet<string>;
  readonly flags: ReadonlySet<string>;
  /**
   * The flag a flag requires (feature-flags catalogue `requires`), or undefined. A route's own `access.flag` must
   * require the route's feature, so GET /v1/me/features and the route always agree on whether it is on.
   */
  readonly flagRequires: (flag: string) => string | undefined;
  /** The database of the module that owns a route. */
  readonly databases: { for(module: string): ModuleDatabase };
  /** The idempotency store of a module with create routes (default: its own table). */
  readonly idempotency: (module: string) => IdempotencyStore;
  /**
   * Support id of a request for its problems: the trace id the server drew for it (ARC-09 FR 3, NFR-10 FR 4;
   * src/platform/telemetry/http.ts). Omitted while it returns undefined (an app without tracing).
   */
  readonly supportId?: (request: FastifyRequest) => string | undefined;
  /**
   * Where server errors are reported (ARC-09 telemetry: src/platform/telemetry/errors.ts); gets a value-free
   * ErrorReport and the request (for its trace) only.
   */
  readonly reportError?: (report: ErrorReport, request: FastifyRequest) => void;
  /**
   * Rate limits per client address (NFR-14 FR 5–10). Omitted: on, with counters in this process. `"off"`
   * only for a load test (configuration `WS_RATE_LIMITS=off-load-test`, never in production).
   */
  readonly rateLimits?: ApiRateLimits | "off";
  /**
   * The origins whose pages may send write requests (NFR-15 FR 5; `WS_ALLOWED_ORIGINS`). Omitted: none, so
   * every write with an `Origin` header is refused; writes without one (non-browser clients) pass.
   */
  readonly allowedOrigins?: ReadonlySet<string>;
}

/**
 * What the API reports about a server error (5xx) to telemetry (DAT-05 FR 9, AGENTS.md «Privacy»): the
 * route template (never the concrete URL, which holds ids), the method, the problem code and status, and the
 * error's class name. Never the error message, the stack, the request body, query or headers: they may hold
 * amounts, account names, names or emails.
 */
export interface ErrorReport {
  readonly method: string;
  /** The route's path template (e.g. `/v1/accounts/:accountId`), or null for an unknown path. */
  readonly route: string | null;
  readonly code: ProblemCode;
  readonly status: number;
  /** The class of the error (`TypeError`, `DatabaseError` …), letters and digits only. */
  readonly errorClass: string;
  /**
   * For a PostgreSQL error (NFR-10 FR 2): the SQLSTATE and the names of the constraint, table, column and
   * schema — never the message or `detail`, which repeat the values.
   */
  readonly database?: DatabaseErrorFields;
  /** For a provider failure (NFR-10 FR 3): adapter, operation and kind — never the URL, parameters or keys. */
  readonly provider?: { readonly provider: string; readonly operation: string; readonly kind: string };
}

/**
 * MODULE_UNAVAILABLE because the flag state is unknown (never loaded, or ≥ 60 s old: fail closed, CICD-06).
 * The client sees the same 503 as for a kill switch; telemetry sees a server error (ARC-09, ADR-0006).
 */
export class FlagStateUnavailable extends ApiProblem {
  constructor() {
    super("MODULE_UNAVAILABLE");
    this.name = "FlagStateUnavailable";
  }
}

/** Seconds a client waits before retrying a module that is switched off. */
export const MODULE_UNAVAILABLE_RETRY_AFTER_S = 60;

function errorClass(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name || error.name : typeof error;
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "Error";
}

function reportServerError(
  reportError: ApiOptions["reportError"],
  request: FastifyRequest,
  code: ProblemCode,
  error: unknown,
): void {
  const { status } = problemBody(code);
  // A module switched off on purpose is not an error; one without a usable flag state is.
  if (!reportError || status < 500) return;
  if (code === "MODULE_UNAVAILABLE" && !(error instanceof FlagStateUnavailable)) return;
  try {
    const database = databaseErrorFields(error);
    reportError(
      {
        method: request.method,
        route: request.is404 ? null : (request.routeOptions.url ?? null),
        code,
        status,
        errorClass: errorClass(error),
        ...(database ? { database } : {}),
        ...(error instanceof ProviderError
          ? { provider: { provider: error.provider, operation: error.operation, kind: error.kind } }
          : {}),
      },
      request,
    );
  } catch {
    // Reporting never changes the answer.
  }
}

function sendProblem(
  reply: FastifyReply,
  code: ProblemCode,
  request: FastifyRequest,
  supportId: ApiOptions["supportId"],
  options: {
    detail?: string | undefined;
    errors?: readonly ProblemFieldError[] | undefined;
    extensions?: ProblemExtensions | undefined;
  } = {},
): FastifyReply {
  markRequestProblem(request, code);
  const body = problemBody(code, { ...options, supportId: supportId?.(request) });
  return reply.code(body.status).header("content-type", PROBLEM_CONTENT_TYPE).send(JSON.stringify(body));
}

/** Fastify's own errors (body parsing, size) mapped to problem codes; anything else is INTERNAL. */
function frameworkProblem(error: FastifyError): ProblemCode {
  switch (error.code) {
    case "FST_ERR_CTP_INVALID_MEDIA_TYPE":
      return "UNSUPPORTED_MEDIA_TYPE";
    case "FST_ERR_CTP_BODY_TOO_LARGE":
      return "PAYLOAD_TOO_LARGE";
    case "FST_ERR_CTP_EMPTY_JSON_BODY":
    case "FST_ERR_CTP_INVALID_JSON_BODY":
    case "FST_ERR_CTP_INVALID_CONTENT_LENGTH":
      return "MALFORMED_REQUEST";
    default:
      return error.statusCode === 400 && error.name === "SyntaxError" ? "MALFORMED_REQUEST" : "INTERNAL";
  }
}

/** Problems for every error and unknown route of the app (also outside /v1). Never internal details. */
export function installProblemHandlers(
  app: FastifyInstance,
  supportId?: ApiOptions["supportId"],
  reportError?: ApiOptions["reportError"],
): void {
  // An unknown path answers 404 before its body is read, exactly like a hidden function (whose flag check runs
  // in onRequest): otherwise a malformed, empty or oversized body would get 400 / 413 on an unknown path only,
  // telling the two apart (DAT-05 FR 7, security review of PR #82). Existing routes are not affected.
  app.addHook("onRequest", async (request) => {
    if (request.is404) throw new ApiProblem("NOT_FOUND");
  });
  app.setNotFoundHandler((request, reply) => sendProblem(reply, "NOT_FOUND", request, supportId));
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApiProblem) {
      reportServerError(reportError, request, error.code, error);
      if (error.code === "MODULE_UNAVAILABLE")
        void reply.header("retry-after", String(MODULE_UNAVAILABLE_RETRY_AFTER_S));
      if (error.retryAfterS !== undefined) void reply.header("retry-after", String(error.retryAfterS));
      return sendProblem(reply, error.code, request, supportId, {
        detail: error.detail,
        errors: error.errors,
        extensions: error.extensions,
      });
    }
    const code = frameworkProblem(error);
    reportServerError(reportError, request, code, error);
    return sendProblem(reply, code, request, supportId);
  });
}

interface SchemaNode {
  readonly _zod: { readonly def: Record<string, unknown> & { readonly type: string } };
}

/**
 * The path of a field error with only names the schema declares: object keys of the schema and array
 * indexes. Any other segment (a key the client chose, e.g. of a record) becomes «*», so a value-like key
 * sent by the client is never echoed back.
 */
export function declaredPath(schema: z.ZodType | undefined, path: readonly PropertyKey[]): string {
  let node = schema as unknown as SchemaNode | undefined;
  const out: string[] = [];
  for (const segment of path) {
    // Wrappers (optional, nullable, default, pipe …) whose path is their inner schema's.
    for (let i = 0; i < 16 && node; i++) {
      const def = node._zod.def;
      const inner = (def["innerType"] ?? (def.type === "pipe" ? def["in"] : undefined)) as
        SchemaNode | undefined;
      if (!inner) break;
      node = inner;
    }
    const def = node?._zod.def;
    if (
      def?.type === "object" &&
      typeof segment === "string" &&
      Object.hasOwn(def["shape"] as object, segment)
    ) {
      out.push(segment);
      node = (def["shape"] as Record<string, SchemaNode>)[segment];
    } else if (def?.type === "array" && typeof segment === "number") {
      out.push(String(segment));
      node = def["element"] as SchemaNode;
    } else {
      out.push("*");
      node = undefined;
    }
  }
  return out.join(".");
}

function fieldErrors(
  where: ProblemFieldError["in"],
  schema: z.ZodType,
  error: z.ZodError,
): ProblemFieldError[] {
  // Declared paths and issue codes only: zod messages could repeat the value that was sent.
  return error.issues.map((issue) => ({
    in: where,
    path: declaredPath(schema, issue.path),
    issue: issue.code,
  }));
}

function parseInput(route: ApiRoute, request: FastifyRequest): RouteInput<ApiRoute["request"] & object> {
  const errors: ProblemFieldError[] = [];
  const part = (where: ProblemFieldError["in"], schema: z.ZodType | undefined, value: unknown): unknown => {
    if (!schema) return undefined;
    const parsed = schema.safeParse(value ?? (where === "body" ? undefined : {}));
    if (parsed.success) return parsed.data;
    errors.push(...fieldErrors(where, schema, parsed.error));
    return undefined;
  };
  const params = part("path", route.request?.params, request.params);
  const query = part("query", route.request?.query, request.query);
  const body = part("body", route.request?.body, request.body);
  if (errors.length > 0) throw new ApiProblem("VALIDATION_FAILED", { errors });
  return { params, query, body } as RouteInput<ApiRoute["request"] & object>;
}

function idempotencyKey(request: FastifyRequest): string | undefined {
  const raw = request.headers[IDEMPOTENCY_HEADER.toLowerCase()];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !IDEMPOTENCY_KEY_RE.test(raw)) {
    throw new ApiProblem("VALIDATION_FAILED", {
      errors: [{ in: "header", path: IDEMPOTENCY_HEADER, issue: "invalid_format" }],
    });
  }
  return raw;
}

/** Marks the routes registerApi mounts; private to this file, so no other code can claim it. */
const API_ROUTE_TOKEN = Symbol("willowsum-api-route");
const guarded = new WeakSet<FastifyInstance>();

/**
 * Could a route with this URL answer a request under /v1? Decided by its first path segment: `v1` in any
 * letter case, or a parametric, wildcard or regex segment (`:`, `*`, `(`), which Fastify would also match
 * for `/v1/…` requests (e.g. `/*` as a static fallback, `/:version/debug`). Literal routes elsewhere
 * (`/health/live`, `/v10-not-api`) cannot.
 */
export function mayServeApiPath(url: string): boolean {
  const first = url.replace(/^\/+/, "").split("/")[0] ?? "";
  return first.toLowerCase() === API_PREFIX.slice(1) || /[:*(]/.test(first);
}

/**
 * Refuses, as it is registered, every route that could serve a /v1 request unless registerApi mounted it:
 * such a route would answer without the session, role and plan checks and outside the contract (ARC-07
 * criterion «маршрут без перевірки прав і плану — 0», NFR-05 FR 1). buildServer installs it before any
 * route; registerApi installs it too (once per app).
 */
export function guardApiRoutes(app: FastifyInstance): void {
  if (guarded.has(app)) return;
  guarded.add(app);
  // A plugin under such a prefix could answer /v1 requests without being a route (its own not-found or error
  // handler). The API layer registers no plugins, so every such plugin is refused.
  app.addHook("onRegister", (instance) => {
    // A bare "/" (or "//", "///") prefix has an empty first segment but still gets its own 404 router for /v1/*.
    if (instance.prefix && (mayServeApiPath(instance.prefix) || /^\/+$/.test(instance.prefix))) {
      throw new Error(
        `Plugin prefix ${instance.prefix}: plugins that can serve ${API_PREFIX} are not allowed; routes are mounted only by registerApi (defineRoute)`,
      );
    }
  });
  app.addHook("onRoute", (route) => {
    const config = route.config as { apiRoute?: unknown } | undefined;
    if (mayServeApiPath(route.url) && config?.apiRoute !== API_ROUTE_TOKEN) {
      throw new Error(
        `Route ${route.url}: routes that can serve ${API_PREFIX} are mounted only by registerApi (defineRoute)`,
      );
    }
  });
}

/** Checks the routes against the API rules before any is served. */
export function assertRoutes(
  routes: readonly ApiRoute[],
  options: Pick<ApiOptions, "permissions" | "features" | "flags"> & Partial<Pick<ApiOptions, "flagRequires">>,
): void {
  const seen = new Set<string>();
  const operations = new Set<string>();
  for (const route of routes) {
    const where = `${route.method} ${route.path}`;
    if (!route.path.startsWith(`${API_PREFIX}/`)) throw new Error(`Route ${where}: outside ${API_PREFIX}`);
    if (seen.has(where)) throw new Error(`Route ${where}: declared twice`);
    if (operations.has(route.operationId))
      throw new Error(`Route ${where}: operationId ${route.operationId} is not unique`);
    seen.add(where);
    operations.add(route.operationId);
    if (isPublic(route.access)) {
      const flag = route.access.flag;
      if (flag !== undefined && !options.flags.has(flag))
        throw new Error(`Route ${where}: unknown flag ${flag} (feature-flags)`);
      continue;
    }
    if (!options.permissions.has(route.access.permission)) {
      throw new Error(`Route ${where}: unknown permission ${route.access.permission} (access-scope)`);
    }
    if (!options.features.has(route.access.feature)) {
      throw new Error(`Route ${where}: unknown feature key ${route.access.feature} (plan-catalog)`);
    }
    for (const flag of routeFlags(route.access)) {
      if (!options.flags.has(flag)) throw new Error(`Route ${where}: unknown flag ${flag} (feature-flags)`);
    }
    const own = route.access.flag;
    if (options.flagRequires && own !== undefined && own !== route.access.feature) {
      const parent = options.flagRequires(own);
      if (parent !== route.access.feature)
        throw new Error(
          `Route ${where}: flag ${own} must require the route's feature ${route.access.feature} (it requires ${parent ?? "nothing"})`,
        );
    }
    if (route.module === null) throw new Error(`Route ${where}: a protected route belongs to a module`);
  }
}

/** Mounts the API routes on the app (role `api`). */
export function registerApi(app: FastifyInstance, options: ApiOptions): void {
  assertRoutes(options.routes, options);
  guardApiRoutes(app);
  const limits = options.rateLimits === "off" ? undefined : (options.rateLimits ?? createApiRateLimits());
  const allowedOrigins = options.allowedOrigins ?? new Set<string>();
  /** Counts the request against one class of its client's address; over the limit → 429 RATE_LIMITED. */
  const limit = async (request: FastifyRequest, limitClass: RateLimitClass): Promise<void> => {
    if (!limits) return;
    const decision = await limits.limiters[limitClass].hit(`${limitClass}:${clientAddressKey(request.ip)}`);
    if (decision.allowed) return;
    // Counted without the address (NFR-17, ADR-0006); a 429 is not a server error.
    recordRateLimitRejection(limitClass, request.is404 ? undefined : request.routeOptions.url);
    throw new RateLimited(limitClass, decision.retryAfterS);
  };
  // Before everything else of a request under the API — also an unknown path, whose 404 is answered in the
  // next hook: the rate limit (an unknown path and a protected route share the `default` class, so a 429
  // never tells them apart), then the Origin of a write. Other routes of the app (health probes) are not API.
  app.addHook("onRequest", async (request) => {
    const config = request.routeOptions.config as
      { apiRoute?: unknown; rateLimitEntry?: RateLimitClass } | undefined;
    const api = config?.apiRoute === API_ROUTE_TOKEN;
    if (!api && !request.is404) return;
    await limit(request, (api ? config?.rateLimitEntry : undefined) ?? "default");
    if (!originAllowed(request, allowedOrigins)) throw new ApiProblem("ORIGIN_NOT_ALLOWED");
  });
  installProblemHandlers(app, options.supportId, options.reportError);
  // Request bodies are JSON only (the contract has no other media type): text/plain is 415, not a string body.
  app.removeContentTypeParser("text/plain");
  // The session found by a route's onRequest hook, for its handler (one entry per request, gone with it).
  const principals = new WeakMap<FastifyRequest, Principal>();
  /**
   * A module switched off by its kill switch answers «temporarily unavailable»; the rest works. Without a
   * usable flag state every module answers the same, but that is an outage, not a decision.
   */
  const moduleOn = async (request: FastifyRequest, module: string): Promise<void> => {
    const state = options.moduleState
      ? await options.moduleState(module)
      : (await options.moduleAvailable(module))
        ? "on"
        : // Without the reason, an unavailable module counts as an outage, never as a deliberate switch.
          "unknown";
    if (state === "killed") {
      markUnavailableReason(request, "kill_switch");
      throw new ApiProblem("MODULE_UNAVAILABLE");
    }
    if (state === "unknown") {
      markUnavailableReason(request, "flags_unknown");
      throw new FlagStateUnavailable();
    }
  };
  /** The request as a public route sees it (cookies only through cookies.ts). */
  const routeHttp = (request: FastifyRequest, reply: FastifyReply): RouteHttp => {
    const cookies = cookieContext(request, options.secureCookies ?? false);
    const set: string[] = [];
    return Object.freeze({
      clientAddress: clientAddressKey(request.ip),
      https: cookies.https,
      sessionCookie: (name: string) => readSessionCookie(request, name, cookies),
      setCookie: (header: string) => {
        set.push(header);
        void reply.header("set-cookie", [...set]);
      },
    });
  };
  for (const route of options.routes) {
    const access = route.access;
    const limitClass = routeRateLimitClass(route);
    app.route({
      method: route.method,
      url: fastifyPath(route.path),
      // The class a request is counted in first: a public route's own (no session or flag to wait for), else
      // `default`. A protected upload route is counted as `upload` too, but only after its session and flags
      // (its onRequest below): a hidden function must not show itself by an earlier 429 (DAT-05 FR 7).
      config: { apiRoute: API_ROUTE_TOKEN, rateLimitEntry: isPublic(access) ? limitClass : "default" },
      ...(route.bodyLimitBytes !== undefined ? { bodyLimit: route.bodyLimitBytes } : {}),
      // Kill switch → session → flags run before the body is read (onRequest), so a switched-off module or a
      // hidden function answers 503 / 401 / 404 whatever body or media type was sent — never 415, 413 or 400
      // first, which would show that the route exists (CICD-06 FR 3, DAT-05 FR 7; ADR-0004).
      ...(isPublic(access)
        ? route.module === null
          ? {}
          : {
              // A module's public route: after the rate limit and Origin (above), the kill switch, then its flag for
              // everyone — all before the body is read.
              onRequest: async (request: FastifyRequest) => {
                await moduleOn(request, route.module as string);
                const flag = access.flag as string;
                if (!(await (options.checkFlagForAll?.(flag) ?? Promise.resolve(false))))
                  throw new ApiProblem("NOT_FOUND");
              },
            }
        : {
            onRequest: async (request: FastifyRequest) => {
              await moduleOn(request, route.module as string);
              const principal = await options.authenticate(request);
              if (!principal) throw new ApiProblem("UNAUTHENTICATED");
              // A function that is off for the space does not exist for it: the same 404 as an unknown path.
              for (const flag of routeFlags(access))
                if (!(await options.checkFlag(principal, flag))) throw new ApiProblem("NOT_FOUND");
              if (limitClass === "upload") await limit(request, "upload");
              principals.set(request, principal);
            },
          }),
      handler: async (request, reply) => {
        // The route's own security headers win over the API defaults, on its successful answers only
        // (NFR-14 FR 1): a problem of the route keeps the defaults (no caching of errors).
        const routeHeaders = (r: FastifyReply): void => {
          for (const [name, value] of Object.entries(route.headers ?? {})) void r.header(name, value);
        };
        const respond = async (status: number, value: unknown): Promise<string> => {
          // Only what the contract declares is sent: unknown fields are stripped, a wrong shape is a 500.
          const body = JSON.stringify(await route.response.schema.parseAsync(value));
          void reply.code(status).header("content-type", "application/json; charset=utf-8");
          routeHeaders(reply);
          return body;
        };
        if (isPublic(route.access)) {
          const input = parseInput(route, request);
          const db = route.module === null ? null : options.databases.for(route.module);
          const ctx: PublicContext = Object.freeze({
            principal: null,
            db: db
              ? Object.freeze({
                  transaction: <T>(work: (q: ModuleQueryRunner) => Promise<T>) => db.transaction(work),
                })
              : null,
            http: routeHttp(request, reply),
            services: route.module === null ? undefined : options.services?.(route.module),
          });
          return reply.send(await respond(route.response.status, await route.handler(input, ctx)));
        }
        const module = route.module as string;
        const principal = principals.get(request);
        // The onRequest hook always sets it; without it nothing of the module runs.
        if (!principal) throw new ApiProblem("INTERNAL");
        if (!options.checkPermission(principal, route.access.permission)) throw new ApiProblem("FORBIDDEN");
        if (!(await options.checkFeature(principal, route.access.feature)))
          throw new ApiProblem("PLAN_LIMIT_REACHED");
        const input = parseInput(route, request);
        const db = options.databases.for(module);
        // Only household-free transactions besides the session-bound one: no `inHousehold(<any id>)` (П-5).
        const householdFree: HouseholdFreeDatabase = Object.freeze({
          transaction: <T>(work: (q: ModuleQueryRunner) => Promise<T>) => db.transaction(work),
        });
        const ctx: ProtectedContext = Object.freeze({
          principal,
          db: householdFree,
          inHousehold: <T>(work: (q: HouseholdQueryRunner) => Promise<T>) =>
            db.inHousehold(principal.householdId, work),
        });
        const key = route.create ? idempotencyKey(request) : undefined;
        if (key === undefined) {
          return reply.send(await respond(route.response.status, await route.handler(input, ctx)));
        }
        const store = options.idempotency(module);
        const hash = requestHash(route.operationId, input);
        const begun = await store.begin(principal.householdId, key, hash);
        if (begun.kind === "mismatch") throw new ApiProblem("IDEMPOTENCY_KEY_REUSED");
        if (begun.kind === "in-progress") throw new ApiProblem("IDEMPOTENCY_REQUEST_IN_PROGRESS");
        if (begun.kind === "replay") {
          routeHeaders(reply);
          return reply
            .code(begun.status)
            .header("content-type", "application/json; charset=utf-8")
            .header(IDEMPOTENCY_REPLAYED_HEADER, "true")
            .send(begun.body);
        }
        let result: unknown;
        try {
          result = await route.handler(input, ctx);
        } catch (error) {
          // The create did not happen: a retry with the same key runs again.
          await store.abandon(principal.householdId, key);
          throw error;
        }
        // From here the create has happened. If the response cannot be shaped (a programming error), the key
        // stays «in progress» until it expires, so a retry gets 409 rather than a second create.
        const body = await respond(route.response.status, result);
        await store.complete(principal.householdId, key, route.response.status, body);
        return reply.send(body);
      },
    });
  }
}
