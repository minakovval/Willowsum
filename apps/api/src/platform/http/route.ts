import { z } from "zod";
import type { HouseholdQueryRunner, ModuleDatabase } from "../db/module-db.ts";

/**
 * Who is calling (ARC-07, П-5). The household comes from the authenticated session, never from the
 * request: route code reaches customer data only through `ctx.inHousehold`, which binds this household.
 * `role` and `scoped` are checked by the access-scope module; the API layer does not interpret them.
 */
export interface Principal {
  readonly userId: string;
  readonly householdId: string;
  readonly role: string;
  /** A member restricted by scope (00-general «Область доступу»): read-only. */
  readonly scoped: boolean;
}

/**
 * What a route checks before its handler runs (ARC-07 criterion «маршрут без перевірки прав і плану — 0»).
 * Every route names a permission (access-scope) and a feature key (plan-catalog), or says why it is public.
 * A public route serves no household data.
 */
export type RouteAccess =
  { readonly permission: string; readonly feature: string } | { readonly public: string };

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

type AnyObject = z.ZodObject<z.ZodRawShape>;

export interface RouteRequest {
  readonly params?: AnyObject;
  readonly query?: AnyObject;
  readonly body?: z.ZodType;
}

type Infer<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface RouteInput<R extends RouteRequest> {
  readonly params: Infer<R["params"]>;
  readonly query: Infer<R["query"]>;
  readonly body: Infer<R["body"]>;
}

export interface PublicContext {
  readonly principal: null;
}

export interface ProtectedContext {
  readonly principal: Principal;
  /** A transaction of the route's own module, bound to the caller's household (ARC-03). */
  inHousehold<T>(work: (db: HouseholdQueryRunner) => Promise<T>): Promise<T>;
  /** The route's own module database, for work outside a household. */
  readonly db: ModuleDatabase;
}

export type RouteContext<A extends RouteAccess> = A extends { readonly public: string }
  ? PublicContext
  : ProtectedContext;

export interface RouteDefinition<
  A extends RouteAccess = RouteAccess,
  R extends RouteRequest = RouteRequest,
  S extends z.ZodType = z.ZodType,
> {
  /** The module that owns the route (its database serves `ctx`), or null for platform routes. */
  readonly module: string | null;
  readonly method: HttpMethod;
  /** OpenAPI path template under the version prefix, e.g. `/v1/accounts/{accountId}`. */
  readonly path: string;
  /** Unique, lowerCamelCase; becomes the operation of the generated client. */
  readonly operationId: string;
  readonly summary: string;
  readonly access: A;
  readonly request?: R;
  readonly response: { readonly status: 200 | 201; readonly description: string; readonly schema: S };
  /** A create request: accepts an `Idempotency-Key` header (ARC-07 FR 4). Only POST. */
  readonly create?: boolean;
  /** A list: server-side pagination with `pageQuery` and `pageOf` (ARC-07 FR 4). */
  readonly list?: boolean;
  /** Marked deprecated on that date (ISO); removable from the contract 6 months later (ARC-07 FR 3). */
  readonly deprecatedSince?: string;
  readonly handler: (input: RouteInput<R>, ctx: RouteContext<A>) => Promise<z.input<S>>;
}

/** A route with its types erased, as the API layer and the contract generator see it. */
export type ApiRoute = RouteDefinition<RouteAccess, RouteRequest, z.ZodType> & {
  readonly handler: (
    input: RouteInput<RouteRequest>,
    ctx: PublicContext | ProtectedContext,
  ) => Promise<unknown>;
};

export const API_PREFIX = "/v1";
const PATH_RE = /^\/v1(\/([a-z0-9]+(-[a-z0-9]+)*|\{[a-z][A-Za-z0-9]*\}))+$/;
const OPERATION_RE = /^[a-z][A-Za-z0-9]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isPublic(access: RouteAccess): access is { readonly public: string } {
  return "public" in access;
}

function objectKeys(schema: z.ZodType | undefined): string[] {
  return schema instanceof z.ZodObject ? Object.keys(schema.shape) : [];
}

/**
 * Declares an API route. Refuses, at module load, a route that would break the API rules: outside /v1,
 * without a permission and a feature key (or a public reason), path parameters that do not match, a
 * create route that is not POST, a list without pagination.
 */
export function defineRoute<A extends RouteAccess, R extends RouteRequest, S extends z.ZodType>(
  route: RouteDefinition<A, R, S>,
): ApiRoute {
  const where = `${route.method} ${route.path}`;
  const fail = (why: string): never => {
    throw new Error(`Route ${where}: ${why}`);
  };
  if (!PATH_RE.test(route.path))
    fail("path must be under /v1 with kebab-case segments and {camelCase} parameters");
  if (!OPERATION_RE.test(route.operationId)) fail("operationId must be lowerCamelCase");
  const access = route.access as RouteAccess | undefined;
  if (!access) fail("declares no access (permission and feature, or public)");
  else if (isPublic(access)) {
    if (!access.public.trim()) fail("a public route must say why it is public");
    if (route.module !== null) fail("public routes are platform routes (module null)");
  } else if (!access.permission?.trim() || !access.feature?.trim()) {
    fail("needs both a permission (access-scope) and a feature key (plan-catalog)");
  }
  const templateParams = [...route.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();
  const declared = objectKeys(route.request?.params).sort();
  if (JSON.stringify(templateParams) !== JSON.stringify(declared)) {
    fail(
      `path parameters ${templateParams.join(", ") || "—"} must match request.params ${declared.join(", ") || "—"}`,
    );
  }
  if (route.request?.body && (route.method === "GET" || route.method === "DELETE"))
    fail("GET and DELETE take no body");
  if (route.create && route.method !== "POST") fail("only POST routes are create routes");
  if (route.list) {
    const query = objectKeys(route.request?.query);
    if (!query.includes("cursor") || !query.includes("limit")) fail("a list takes pageQuery (cursor, limit)");
    const out = objectKeys(route.response.schema);
    if (!out.includes("items") || !out.includes("nextCursor")) fail("a list answers with pageOf(item)");
  }
  if (route.deprecatedSince !== undefined && !DATE_RE.test(route.deprecatedSince))
    fail("deprecatedSince is YYYY-MM-DD");
  if (!(route.response.schema instanceof z.ZodObject)) fail("the response is a JSON object");
  return route as unknown as ApiRoute;
}

/** Fastify path from the OpenAPI template: `{id}` → `:id`. */
export function fastifyPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}
