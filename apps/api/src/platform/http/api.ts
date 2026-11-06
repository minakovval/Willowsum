import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
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
  type ApiRoute,
  type HouseholdFreeDatabase,
  type Principal,
  type ProtectedContext,
  type RouteInput,
} from "./route.ts";

/**
 * The one HTTP API of every client (ARC-07 FR 1, NFR-05 FR 1–2). For each request, in this order:
 * authentication (401) → role and scope (access-scope, 403) → plan (plan-catalog, 402) → input validation
 * with the route's zod schemas (400) → idempotency for create routes (409 / replay) → handler → the
 * response parsed by the route's response schema (fields not in the contract never leave the server).
 */
export interface ApiOptions {
  readonly routes: readonly ApiRoute[];
  /** The session of the request (identity, ACC-01). Null: not signed in. */
  readonly authenticate: (request: FastifyRequest) => Promise<Principal | null>;
  /** Role and scope check (access-scope). */
  readonly checkPermission: (principal: Principal, permission: string) => boolean;
  /** Plan check by feature key (plan-catalog). */
  readonly checkFeature: (principal: Principal, feature: string) => Promise<boolean>;
  /** Every permission and feature key that exists; a route naming another one is refused at start. */
  readonly permissions: ReadonlySet<string>;
  readonly features: ReadonlySet<string>;
  /** The database of the module that owns a route. */
  readonly databases: { for(module: string): ModuleDatabase };
  /** The idempotency store of a module with create routes (default: its own table). */
  readonly idempotency: (module: string) => IdempotencyStore;
  /** Support id for problems (ARC-09 traces); omitted while it returns undefined. */
  readonly supportId?: (request: FastifyRequest) => string | undefined;
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
export function installProblemHandlers(app: FastifyInstance, supportId?: ApiOptions["supportId"]): void {
  app.setNotFoundHandler((request, reply) => sendProblem(reply, "NOT_FOUND", request, supportId));
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApiProblem) {
      return sendProblem(reply, error.code, request, supportId, {
        detail: error.detail,
        errors: error.errors,
      });
    }
    return sendProblem(reply, frameworkProblem(error), request, supportId);
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
 * Refuses, as it is registered, every route under /v1 (any letter case) that registerApi did not mount: such
 * a route would be served without the session, role and plan checks and outside the contract (ARC-07
 * criterion «маршрут без перевірки прав і плану — 0», NFR-05 FR 1). buildServer installs it before any
 * route; registerApi installs it too (once per app).
 */
export function guardApiRoutes(app: FastifyInstance): void {
  if (guarded.has(app)) return;
  guarded.add(app);
  app.addHook("onRoute", (route) => {
    const url = route.url.toLowerCase();
    const underApi = url === API_PREFIX || url.startsWith(`${API_PREFIX}/`);
    const config = route.config as { apiRoute?: unknown } | undefined;
    if (underApi && config?.apiRoute !== API_ROUTE_TOKEN) {
      throw new Error(
        `Route ${route.url}: routes under ${API_PREFIX} are mounted only by registerApi (defineRoute)`,
      );
    }
  });
}

/** Checks the routes against the API rules before any is served. */
export function assertRoutes(
  routes: readonly ApiRoute[],
  options: Pick<ApiOptions, "permissions" | "features">,
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
    if (route.module === null) throw new Error(`Route ${where}: a protected route belongs to a module`);
  }
}

/** Mounts the API routes on the app (role `api`). */
export function registerApi(app: FastifyInstance, options: ApiOptions): void {
  assertRoutes(options.routes, options);
  guardApiRoutes(app);
  installProblemHandlers(app, options.supportId);
  // Request bodies are JSON only (the contract has no other media type): text/plain is 415, not a string body.
  app.removeContentTypeParser("text/plain");
  for (const route of options.routes) {
    app.route({
      method: route.method,
      url: fastifyPath(route.path),
      config: { apiRoute: API_ROUTE_TOKEN },
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
        const principal = await options.authenticate(request);
        if (!principal) throw new ApiProblem("UNAUTHENTICATED");
        if (!options.checkPermission(principal, route.access.permission)) throw new ApiProblem("FORBIDDEN");
        if (!(await options.checkFeature(principal, route.access.feature)))
          throw new ApiProblem("PLAN_LIMIT_REACHED");
        const input = parseInput(route, request);
        const module = route.module as string;
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
