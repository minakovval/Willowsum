import { z } from "zod";
import type { HouseholdQueryRunner, ModuleDatabase } from "../db/module-db.ts";
import { API_BODY_LIMIT_BYTES } from "./limits.ts";
import { pageQuery } from "./pagination.ts";
import { RATE_LIMITS, RATE_LIMIT_CLASSES, type RateLimitClass } from "./rate-limit.ts";
import { ROUTE_HEADER_VALUE_RE, ROUTE_OVERRIDABLE_HEADERS, type RouteHeaders } from "./security-headers.ts";

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
 *
 * The flag of a protected route (feature-flags, CICD-06) is `flag`, or by default its feature key: every
 * function has a key in the feature catalogue and a flag under that key (ARC-01 FR 7). A route of a new
 * sub-function names its own flag as well: then both its feature's flag and its own must be on, so switching
 * the function off also hides the sub-function. While a flag is off for the caller's space the route answers
 * 404, as if it did not exist (DAT-05 FR 7); while its module's kill switch is on it answers 503.
 */
export type RouteAccess =
  | { readonly permission: string; readonly feature: string; readonly flag?: string }
  | { readonly public: string };

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

/**
 * What route code gets of its module's database: transactions bound to no household only. A household
 * transaction is reachable solely through `ctx.inHousehold`, bound to the session's household, so route code
 * cannot bind a household taken from the request (П-5, ADR-0003).
 */
export type HouseholdFreeDatabase = Pick<ModuleDatabase, "transaction">;

export interface ProtectedContext {
  readonly principal: Principal;
  /** A transaction of the route's own module, bound to the caller's household (ARC-03). */
  inHousehold<T>(work: (db: HouseholdQueryRunner) => Promise<T>): Promise<T>;
  /** The route's own module database, for work outside a household (customer tables show no rows there). */
  readonly db: HouseholdFreeDatabase;
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
  /**
   * The rate-limit class (NFR-14 FR 5): `public` (60 per minute per address) for public routes — the default
   * and the only class looser than `upload` they may have; `upload` (30) for file uploads; `default` (600)
   * for the rest, the default of protected routes. A route may only be stricter than its default.
   */
  readonly rateLimit?: RateLimitClass;
  /**
   * The route's own values of security headers (NFR-14 FR 1), which win over the API defaults on its
   * successful answer: e.g. `cache-control: private, max-age=300`, a CSP with `sandbox`, `SAMEORIGIN`.
   */
  readonly headers?: RouteHeaders;
  /** A body limit below the API's 1 MiB (NFR-15 FR 17), in bytes. */
  readonly bodyLimitBytes?: number;
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

/** The rate-limit class of a route: its own, or `public` for public and `default` for protected routes. */
export function routeRateLimitClass(route: Pick<RouteDefinition, "access" | "rateLimit">): RateLimitClass {
  return route.rateLimit ?? (isPublic(route.access) ? "public" : "default");
}

/** The most specific flag of a protected route: its own `flag`, or its feature key. */
export function routeFlag(access: { readonly feature: string; readonly flag?: string }): string {
  return access.flag ?? access.feature;
}

/** Every flag a protected route is behind, all of which must be on: its feature's flag, then its own. */
export function routeFlags(access: { readonly feature: string; readonly flag?: string }): string[] {
  return access.flag === undefined || access.flag === access.feature
    ? [access.feature]
    : [access.feature, access.flag];
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
  } else if (access.flag !== undefined && !access.flag.trim()) {
    fail("an explicit flag must name a flag of feature-flags");
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
  const queryShape = route.request?.query instanceof z.ZodObject ? route.request.query.shape : {};
  for (const key of ["cursor", "limit"] as const) {
    // The page bound (≤ 100) is structural: `cursor` and `limit` are always the platform's own fields.
    if (key in queryShape && queryShape[key] !== pageQuery.shape[key])
      fail(`query «${key}» must be pageQuery's own field`);
  }
  if (route.list) {
    const query = objectKeys(route.request?.query);
    if (!query.includes("cursor") || !query.includes("limit")) fail("a list takes pageQuery (cursor, limit)");
    const out = objectKeys(route.response.schema);
    if (!out.includes("items") || !out.includes("nextCursor")) fail("a list answers with pageOf(item)");
  }
  if (route.deprecatedSince !== undefined && !DATE_RE.test(route.deprecatedSince))
    fail("deprecatedSince is YYYY-MM-DD");
  if (route.rateLimit !== undefined) {
    if (!RATE_LIMIT_CLASSES.includes(route.rateLimit)) fail("rateLimit is public, upload or default");
    const loosest = access && isPublic(access) ? "public" : "default";
    if (RATE_LIMITS[route.rateLimit] > RATE_LIMITS[loosest])
      fail(`rateLimit ${route.rateLimit} is looser than the ${loosest} class of this route`);
  }
  for (const [name, value] of Object.entries(route.headers ?? {})) {
    if (!(ROUTE_OVERRIDABLE_HEADERS as readonly string[]).includes(name))
      fail(`header ${name} cannot be set by a route (only ${ROUTE_OVERRIDABLE_HEADERS.join(", ")})`);
    if (typeof value !== "string" || !ROUTE_HEADER_VALUE_RE.test(value))
      fail(`header ${name} has an invalid value`);
  }
  if (
    route.bodyLimitBytes !== undefined &&
    (!Number.isInteger(route.bodyLimitBytes) ||
      route.bodyLimitBytes < 1 ||
      route.bodyLimitBytes > API_BODY_LIMIT_BYTES)
  )
    fail(`bodyLimitBytes is 1–${API_BODY_LIMIT_BYTES}`);
  if (!(route.response.schema instanceof z.ZodObject)) fail("the response is a JSON object");
  return route as unknown as ApiRoute;
}

/** Fastify path from the OpenAPI template: `{id}` → `:id`. */
export function fastifyPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}
