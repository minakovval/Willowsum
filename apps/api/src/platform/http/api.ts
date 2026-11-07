import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { ProviderError } from "../adapters/errors.ts";
import { databaseErrorFields, type DatabaseErrorFields } from "../db/errors.ts";
import type { HouseholdQueryRunner, ModuleDatabase, ModuleQueryRunner } from "../db/module-db.ts";
import {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_RE,
  IDEMPOTENCY_REPLAYED_HEADER,
  requestHash,
  type IdempotencyStore,
} from "./idempotency.ts";
import {
  ApiProblem,
  PROBLEM_CONTENT_TYPE,
  problemBody,
  type ProblemCode,
  type ProblemFieldError,
} from "./problem.ts";
import {
  API_PREFIX,
  fastifyPath,
  isPublic,
  routeFlags,
  type ApiRoute,
  type HouseholdFreeDatabase,
  type Principal,
  type ProtectedContext,
  type RouteInput,
} from "./route.ts";

/**
 * The one HTTP API of every client (ARC-07 FR 1, NFR-05 FR 1–2). For each request, in this order:
 * the module's kill switch (feature-flags, 503 MODULE_UNAVAILABLE) → authentication (401) → the route's flag
 * for the caller's space (feature-flags, 404 as for a route that does not exist) → role and scope
 * (access-scope, 403) → plan (plan-catalog, 402) → input validation with the route's zod schemas (400) →
 * idempotency for create routes (409 / replay) → handler → the response parsed by the route's response
 * schema (fields not in the contract never leave the server). Public (platform) routes have no module, flag
 * or session: only validation and the handler.
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
  /** Is the flag on for the caller's space (feature-flags, CICD-06 FR 1)? */
  readonly checkFlag: (principal: Principal, flag: string) => Promise<boolean>;
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
  // A module switched off on purpose is not an error.
  if (!reportError || status < 500 || code === "MODULE_UNAVAILABLE") return;
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
  options: { detail?: string | undefined; errors?: readonly ProblemFieldError[] | undefined } = {},
): FastifyReply {
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
      return sendProblem(reply, error.code, request, supportId, {
        detail: error.detail,
        errors: error.errors,
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
    if (isPublic(route.access)) continue;
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
  installProblemHandlers(app, options.supportId, options.reportError);
  // Request bodies are JSON only (the contract has no other media type): text/plain is 415, not a string body.
  app.removeContentTypeParser("text/plain");
  // The session found by a route's onRequest hook, for its handler (one entry per request, gone with it).
  const principals = new WeakMap<FastifyRequest, Principal>();
  for (const route of options.routes) {
    const access = route.access;
    app.route({
      method: route.method,
      url: fastifyPath(route.path),
      config: { apiRoute: API_ROUTE_TOKEN },
      // Kill switch → session → flags run before the body is read (onRequest), so a switched-off module or a
      // hidden function answers 503 / 401 / 404 whatever body or media type was sent — never 415, 413 or 400
      // first, which would show that the route exists (CICD-06 FR 3, DAT-05 FR 7; ADR-0004).
      ...(isPublic(access)
        ? {}
        : {
            onRequest: async (request: FastifyRequest) => {
              // A module switched off by its kill switch answers «temporarily unavailable»; the rest works.
              if (!(await options.moduleAvailable(route.module as string)))
                throw new ApiProblem("MODULE_UNAVAILABLE");
              const principal = await options.authenticate(request);
              if (!principal) throw new ApiProblem("UNAUTHENTICATED");
              // A function that is off for the space does not exist for it: the same 404 as an unknown path.
              for (const flag of routeFlags(access))
                if (!(await options.checkFlag(principal, flag))) throw new ApiProblem("NOT_FOUND");
              principals.set(request, principal);
            },
          }),
      handler: async (request, reply) => {
        const respond = async (status: number, value: unknown): Promise<string> => {
          // Only what the contract declares is sent: unknown fields are stripped, a wrong shape is a 500.
          const body = JSON.stringify(await route.response.schema.parseAsync(value));
          void reply.code(status).header("content-type", "application/json; charset=utf-8");
          return body;
        };
        if (isPublic(route.access)) {
          const input = parseInput(route, request);
          return reply.send(
            await respond(route.response.status, await route.handler(input, { principal: null })),
          );
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
