import { z } from "zod";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER, IDEMPOTENCY_TTL_HOURS } from "./idempotency.ts";
import { PROBLEM_CONTENT_TYPE, PROBLEMS, ProblemSchema } from "./problem.ts";
import { WRITE_METHODS } from "./origin.ts";
import { RATE_LIMITS } from "./rate-limit.ts";
import { isPublic, routeFlags, routeRateLimitClass, type ApiRoute } from "./route.ts";

/**
 * The OpenAPI 3.1 contract (ARC-07 FR 2), generated from the same zod schemas that validate requests and
 * shape responses (JSON Schema 2020-12 from `z.toJSONSchema`, which OpenAPI 3.1 uses as is). The committed
 * copy is `packages/api-contract/openapi.json`; CI fails when it differs from this output
 * (`pnpm --filter @willowsum/api contract:check`) and when it changes incompatibly against the base branch.
 */
export const API_VERSION = "v1" as const;
export const ACCESS_EXTENSION = "x-willowsum-access";
export const DEPRECATED_SINCE_EXTENSION = "x-deprecated-since";

type Json = Record<string, unknown>;

function jsonSchema(schema: z.ZodType, io: "input" | "output"): Json {
  const out = z.toJSONSchema(schema, { target: "draft-2020-12", io, unrepresentable: "throw" }) as Json;
  delete out["$schema"];
  return out;
}

const PROBLEM_REF = { $ref: "#/components/schemas/Problem" };

function problemResponse(description: string): Json {
  return { description, content: { [PROBLEM_CONTENT_TYPE]: { schema: PROBLEM_REF } } };
}

function parameters(where: "path" | "query", schema: z.ZodType | undefined): Json[] {
  if (!schema) return [];
  const object = jsonSchema(schema, "input");
  const properties = (object["properties"] ?? {}) as Record<string, Json>;
  const required = new Set((object["required"] ?? []) as string[]);
  return Object.entries(properties).map(([name, property]) => {
    const { description, deprecated, ...rest } = property;
    return {
      name,
      in: where,
      required: where === "path" || required.has(name),
      ...(description !== undefined ? { description } : {}),
      ...(deprecated === true ? { deprecated: true } : {}),
      schema: rest,
    };
  });
}

function operation(route: ApiRoute): Json {
  const params = [...parameters("path", route.request?.params), ...parameters("query", route.request?.query)];
  if (route.create) {
    params.push({
      name: IDEMPOTENCY_HEADER,
      in: "header",
      required: false,
      description: `Repeating a create with the same key and the same request returns the first response (kept ${IDEMPOTENCY_TTL_HOURS} h); the same key with another request is 409.`,
      schema: { type: "string", minLength: 1, maxLength: 128, pattern: "^[\\x21-\\x7e]+$" },
    });
  }
  const responses: Json = {
    [String(route.response.status)]: {
      description: route.response.description,
      ...(route.create
        ? {
            headers: {
              [IDEMPOTENCY_REPLAYED_HEADER]: {
                description: "true when this is the stored response of an earlier request with the same key",
                schema: { type: "string", enum: ["true"] },
              },
            },
          }
        : {}),
      content: { "application/json": { schema: jsonSchema(route.response.schema, "output") } },
    },
    "400": problemResponse("The request is not valid (VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_CURSOR)"),
  };
  if (!isPublic(route.access)) {
    responses["401"] = problemResponse("Not signed in (UNAUTHENTICATED)");
    responses["402"] = problemResponse("The plan of the space does not include this (PLAN_LIMIT_REACHED)");
    responses["403"] = problemResponse("The role or scope does not allow this (FORBIDDEN)");
    responses["404"] = problemResponse(
      "Not found (NOT_FOUND): the record does not exist for the caller, or the function is off for the space",
    );
    responses["503"] = problemResponse(
      "The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later",
    );
  }
  if (isPublic(route.access) && route.module !== null) {
    responses["404"] = problemResponse("Not found (NOT_FOUND): the function is off");
    responses["503"] = problemResponse(
      "The function is temporarily unavailable (MODULE_UNAVAILABLE): its module is switched off; retry later",
    );
  }
  if (WRITE_METHODS.has(route.method)) {
    responses["403"] = problemResponse(
      isPublic(route.access)
        ? "The request comes from a page of another site (ORIGIN_NOT_ALLOWED)"
        : "The role or scope does not allow this (FORBIDDEN), or the request comes from a page of another site (ORIGIN_NOT_ALLOWED)",
    );
  }
  responses["429"] = {
    ...problemResponse(
      `Too many requests from this client in the current minute (RATE_LIMITED; ${RATE_LIMITS[routeRateLimitClass(route)]} per minute for this route)`,
    ),
    headers: {
      "Retry-After": {
        description: "Seconds until the current one-minute window ends",
        schema: { type: "integer", minimum: 1 },
      },
    },
  };
  if (route.create) {
    responses["409"] = problemResponse(
      "The idempotency key was used for another request, or that request is still running",
    );
  }
  // The route's own outcomes, each under its status: the code and its title (ACC-01: sign-in and sign-up).
  for (const code of route.problems ?? []) {
    const { status, title } = PROBLEMS[code];
    const key = String(status);
    const own = `${title} (${code})`;
    const existing = responses[key] as Json | undefined;
    responses[key] = existing
      ? { ...existing, description: `${existing["description"] as string}; ${own}` }
      : problemResponse(own);
  }
  responses["default"] = problemResponse("Any other error, as problem details");
  return {
    operationId: route.operationId,
    summary: route.summary,
    tags: [route.module ?? "platform"],
    ...(route.deprecatedSince !== undefined
      ? { deprecated: true, [DEPRECATED_SINCE_EXTENSION]: route.deprecatedSince }
      : {}),
    [ACCESS_EXTENSION]: isPublic(route.access)
      ? {
          public: route.access.public,
          ...(route.access.flag !== undefined ? { flags: [route.access.flag] } : {}),
        }
      : {
          permission: route.access.permission,
          feature: route.access.feature,
          flags: routeFlags(route.access),
        },
    ...(params.length > 0 ? { parameters: params } : {}),
    ...(route.request?.body
      ? {
          requestBody: {
            required: !route.request.body.safeParse(undefined).success,
            content: { "application/json": { schema: jsonSchema(route.request.body, "input") } },
          },
        }
      : {}),
    responses,
  };
}

/** The whole contract, deterministic: paths and methods in sorted order. */
export function buildOpenApi(routes: readonly ApiRoute[]): Json {
  const paths: Record<string, Record<string, Json>> = {};
  const sorted = [...routes].sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path < b.path ? -1 : 1,
  );
  for (const route of sorted) {
    (paths[route.path] ??= {})[route.method.toLowerCase()] = operation(route);
  }
  return {
    openapi: "3.1.1",
    info: {
      title: "Willowsum API",
      version: API_VERSION,
      description:
        "The one HTTP API of every Willowsum client (ARC-07). Within /v1 only compatible changes are made; removal only after a deprecation mark and at least 6 months. Errors are RFC 9457 problem details with a machine code.",
    },
    paths,
    components: { schemas: { Problem: jsonSchema(ProblemSchema, "output") } },
  };
}

/** The contract as committed: two-space JSON with a final newline. */
export function serializeOpenApi(document: Json): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
