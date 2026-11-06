import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createApiClient, isProblem } from "@willowsum/api-contract";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { apiOptions, apiRoutes } from "../src/api.ts";
import { registerApi } from "../src/platform/http/api.ts";
import { buildOpenApi, serializeOpenApi } from "../src/platform/http/openapi.ts";
import { fastifyPath } from "../src/platform/http/route.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { fakeDatabases, PRINCIPAL_HEADER, principalHeader, testAuthenticate } from "./http.ts";

/**
 * ARC-07 criterion «розбіжність між контрактом і реалізацією — 0»: the committed contract is the one the
 * routes generate, every served route is in it, and real responses (requested through the generated client)
 * match the committed schemas.
 */
const committedText = readFileSync(
  new URL("../../../packages/api-contract/openapi.json", import.meta.url),
  "utf8",
);
type Doc = {
  paths: Record<
    string,
    Record<string, { responses: Record<string, { content?: Record<string, { schema: unknown }> }> }>
  >;
  components: { schemas: Record<string, unknown> };
};
const committed = JSON.parse(committedText) as Doc;

/** A validator for a schema of the committed contract (refs into components resolved). */
function validator(schema: unknown): z.ZodType {
  const inline = JSON.parse(
    JSON.stringify(schema).replace(/\{"\$ref":"#\/components\/schemas\/([A-Za-z]+)"\}/g, (_, name: string) =>
      JSON.stringify(committed.components.schemas[name]),
    ),
  ) as Parameters<typeof z.fromJSONSchema>[0];
  return z.fromJSONSchema(inline);
}

function responseSchema(path: string, method: string, status: string): z.ZodType {
  const responses = committed.paths[path]![method]!.responses;
  const response = responses[status] ?? responses["default"]!;
  const content = response.content!;
  return validator((content["application/json"] ?? content["application/problem+json"])!.schema);
}

let app: FastifyInstance;
const served: string[] = [];
let baseUrl: string;

beforeAll(async () => {
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (server) => {
      server.addHook("onRoute", (route) => {
        for (const method of [route.method].flat())
          if (method !== "HEAD") served.push(`${method} ${route.url}`);
      });
      registerApi(server, {
        ...apiOptions({ databases: fakeDatabases().databases, entitlements: "all-enabled" }),
        authenticate: testAuthenticate,
      });
    },
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app?.close();
});

describe("ARC-07 criterion «розбіжність між контрактом і реалізацією — 0»", () => {
  it("the committed packages/api-contract/openapi.json is exactly what the routes generate", () => {
    expect(committedText).toBe(serializeOpenApi(buildOpenApi(apiRoutes)));
  });

  it("NFR-05 FR 1: every route the API serves is in the contract, and every contract operation is served (no hidden endpoints)", () => {
    const documented = Object.entries(committed.paths).flatMap(([path, item]) =>
      Object.keys(item).map((method) => `${method.toUpperCase()} ${fastifyPath(path)}`),
    );
    // Everything the API mounts is under /v1 (outside it the server has only the ARC-02 probes, which serve no data).
    expect(served.sort()).toEqual(documented.sort());
  });

  it("GET /v1/meta through the generated client matches the committed response schema", async () => {
    const client = createApiClient({ baseUrl });
    const { data, response } = await client.GET("/v1/meta");
    expect(response.status).toBe(200);
    expect(responseSchema("/v1/meta", "get", "200").safeParse(data).success).toBe(true);
    expect(data?.apiVersion).toBe("v1");
    // The validator is strict: a response the contract does not describe fails.
    expect(responseSchema("/v1/meta", "get", "200").safeParse({ apiVersion: "v2" }).success).toBe(false);
  });

  it("GET /v1/me/permissions through the generated client matches the committed schema, signed in or not", async () => {
    const client = createApiClient({ baseUrl, headers: principalHeader({ role: "viewer" }) });
    const { data } = await client.GET("/v1/me/permissions");
    expect(responseSchema("/v1/me/permissions", "get", "200").parse(data)).toEqual({
      role: "viewer",
      scoped: false,
      permissions: ["household.data.read"],
    });
    const anonymous = await createApiClient({ baseUrl }).GET("/v1/me/permissions");
    expect(anonymous.response.status).toBe(401);
    expect(isProblem(anonymous.error)).toBe(true);
    expect(responseSchema("/v1/me/permissions", "get", "401").safeParse(anonymous.error).success).toBe(true);
  });

  it("a problem for an unknown route matches the committed Problem schema", async () => {
    const res = await fetch(`${baseUrl}/v1/not-a-route`, { headers: { [PRINCIPAL_HEADER]: "{}" } });
    expect(res.status).toBe(404);
    expect(validator({ $ref: "#/components/schemas/Problem" }).safeParse(await res.json()).success).toBe(
      true,
    );
  });
});
