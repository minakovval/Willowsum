import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildOpenApi, serializeOpenApi } from "./openapi.ts";
import { pageOf, pageQuery } from "./pagination.ts";
import { defineRoute } from "./route.ts";

const body = z.strictObject({ name: z.string().min(1).max(40), kind: z.enum(["a", "b"]).optional() });
const create = defineRoute({
  module: "things",
  method: "POST",
  path: "/v1/things",
  operationId: "createThing",
  summary: "Create",
  access: { permission: "things.write", feature: "things" },
  create: true,
  request: { body },
  response: { status: 201, description: "Created", schema: z.object({ id: z.string() }) },
  handler: async () => ({ id: "1" }),
});
const list = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things",
  operationId: "listThings",
  summary: "List",
  access: { permission: "things.read", feature: "things" },
  list: true,
  request: { query: pageQuery },
  response: { status: 200, description: "Page", schema: pageOf(z.object({ id: z.string() })) },
  handler: async () => ({ items: [], nextCursor: null }),
});
const old = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things/{thingId}",
  operationId: "getThing",
  summary: "Old",
  access: { permission: "things.read", feature: "things" },
  deprecatedSince: "2026-11-01",
  request: { params: z.object({ thingId: z.string() }) },
  response: { status: 200, description: "Thing", schema: z.object({ id: z.string() }) },
  handler: async () => ({ id: "1" }),
});

type Op = Record<string, unknown> & {
  parameters?: Array<Record<string, unknown>>;
  responses: Record<string, Record<string, unknown>>;
};
const doc = buildOpenApi([create, list, old]) as {
  openapi: string;
  paths: Record<string, Record<string, Op>>;
};

describe("ARC-07 FR 2: OpenAPI 3.1 from the schemas that validate requests", () => {
  it("is OpenAPI 3.1 with every path under /v1", () => {
    expect(doc.openapi).toMatch(/^3\.1\./);
    expect(Object.keys(doc.paths).every((p) => p.startsWith("/v1/"))).toBe(true);
  });

  it("the request body schema is the JSON Schema of the very zod schema that validates it", () => {
    const schema = (
      doc.paths["/v1/things"]!["post"]!["requestBody"] as { content: Record<string, { schema: unknown }> }
    ).content["application/json"]!.schema;
    const expected = z.toJSONSchema(body, { target: "draft-2020-12", io: "input" }) as Record<
      string,
      unknown
    >;
    delete expected["$schema"];
    expect(schema).toEqual(expected);
  });

  it("FR 4: a create route documents the Idempotency-Key header and 409; a list documents cursor and limit", () => {
    const post = doc.paths["/v1/things"]!["post"]!;
    expect(post.parameters).toEqual([
      expect.objectContaining({ name: "Idempotency-Key", in: "header", required: false }),
    ]);
    expect(post.responses).toHaveProperty("409");
    const get = doc.paths["/v1/things"]!["get"]!;
    expect(get.parameters!.map((p) => [p["name"], p["in"], p["required"]])).toEqual([
      ["cursor", "query", false],
      ["limit", "query", false],
    ]);
  });

  it("FR 4: every error response is problem details (application/problem+json, components.schemas.Problem)", () => {
    for (const status of ["400", "401", "402", "403", "default"]) {
      expect(doc.paths["/v1/things"]!["get"]!.responses[status]).toEqual({
        description: expect.any(String),
        content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
      });
    }
  });

  it("each operation records its permission and feature key; FR 3: a deprecated one carries its date", () => {
    const get = doc.paths["/v1/things/{thingId}"]!["get"]!;
    expect(get["x-willowsum-access"]).toEqual({
      permission: "things.read",
      feature: "things",
      flag: "things",
    });
    expect(get["deprecated"]).toBe(true);
    expect(get["x-deprecated-since"]).toBe("2026-11-01");
    expect(get.parameters).toEqual([
      expect.objectContaining({ name: "thingId", in: "path", required: true }),
    ]);
  });

  it("is deterministic (same routes in another order → same document)", () => {
    expect(serializeOpenApi(buildOpenApi([old, list, create]))).toBe(
      serializeOpenApi(buildOpenApi([create, list, old])),
    );
  });
});
