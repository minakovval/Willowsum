import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerApi, type ApiOptions } from "../src/platform/http/api.ts";
import { metaRoute } from "../src/platform/http/meta.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { API_SECURITY_HEADERS, HSTS_HEADER, HSTS_VALUE } from "../src/platform/http/security-headers.ts";
import { buildServer, type ReadinessCheck } from "../src/platform/process/server.ts";
import { principalHeader, testApiOptions } from "./http.ts";

/**
 * NFR-14 FR 1 and criterion «Заголовки API»: every header of the table on 100 % of API responses — typical
 * routes and the special ones (problems, unknown paths, Fastify's own errors, the kill switch, the probes,
 * the 503 while stopping, 429) — and a route's own value wins. HSTS only in staging and production.
 */
const access = { permission: "things.read", feature: "things" };

const getThing = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things/{thingId}",
  operationId: "getThingHeaders",
  summary: "x",
  access,
  request: { params: z.object({ thingId: z.string() }) },
  response: { status: 200, description: "x", schema: z.object({ amount: z.string() }) },
  // Financial data (AC2).
  handler: async () => ({ amount: "1234.56" }),
});

const createThing = defineRoute({
  module: "things",
  method: "POST",
  path: "/v1/things",
  operationId: "createThingHeaders",
  summary: "x",
  access,
  request: { body: z.object({ name: z.string() }) },
  response: { status: 201, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});

/** A route with its own values: a cacheable schema and a file shown in the app's own viewer. */
const thingSchema = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/thing-types/{typeId}/schema",
  operationId: "getThingTypeSchemaHeaders",
  summary: "x",
  access,
  request: { params: z.object({ typeId: z.string() }) },
  headers: {
    "cache-control": "private, max-age=300",
    "x-frame-options": "SAMEORIGIN",
    "content-security-policy": "default-src 'none'; frame-ancestors 'self'; sandbox",
  },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async ({ params }) => {
    if (params.typeId === "fail") throw new Error("boom");
    return { ok: true };
  },
});

const boom = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things-broken",
  operationId: "brokenHeaders",
  summary: "x",
  access,
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => {
    throw new Error("boom");
  },
});

const routes = [metaRoute, getThing, createThing, thingSchema, boom];

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function serve(
  options: { hsts?: boolean; readiness?: ReadinessCheck; api?: Partial<ApiOptions> } = {},
): Promise<FastifyInstance> {
  app = buildServer({
    readiness: options.readiness ?? (async () => ({ ready: true })),
    ...(options.hsts !== undefined ? { hsts: options.hsts } : {}),
    api: (a) => registerApi(a, testApiOptions(routes, options.api)),
  });
  await app.ready();
  return app;
}

function expectApiHeaders(response: { headers: Record<string, unknown> }, where: string, hsts = false): void {
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS))
    expect(response.headers[name], `${where}: ${name}`).toBe(value);
  if (hsts) expect(response.headers[HSTS_HEADER], `${where}: HSTS`).toBe(HSTS_VALUE);
  else expect(response.headers[HSTS_HEADER], `${where}: no HSTS`).toBeUndefined();
}

const json = { "content-type": "application/json" };

/** Typical and special requests with the status each one gets. */
const CASES: readonly [string, InjectOptions, number][] = [
  ["protected read", { method: "GET", url: "/v1/things/a", headers: principalHeader() }, 200],
  [
    "protected create",
    { method: "POST", url: "/v1/things", headers: { ...principalHeader(), ...json }, payload: { name: "n" } },
    201,
  ],
  ["not signed in (401)", { method: "GET", url: "/v1/things/a" }, 401],
  [
    "invalid input (400)",
    { method: "POST", url: "/v1/things", headers: { ...principalHeader(), ...json }, payload: { name: 1 } },
    400,
  ],
  [
    "malformed body (400)",
    { method: "POST", url: "/v1/things", headers: { ...principalHeader(), ...json }, payload: "{" },
    400,
  ],
  [
    "wrong media type (415)",
    {
      method: "POST",
      url: "/v1/things",
      headers: { ...principalHeader(), "content-type": "text/plain" },
      payload: "x",
    },
    415,
  ],
  [
    "body over 1 MiB (413)",
    {
      method: "POST",
      url: "/v1/things",
      headers: { ...principalHeader(), ...json },
      payload: JSON.stringify({ name: "x".repeat(1024 * 1024) }),
    },
    413,
  ],
  ["server error (500)", { method: "GET", url: "/v1/things-broken", headers: principalHeader() }, 500],
  ["unknown path (404)", { method: "GET", url: "/v1/no-such-path" }, 404],
  ["unknown path outside /v1 (404)", { method: "GET", url: "/robots.txt" }, 404],
  ["URL Fastify cannot decode (frameworkErrors)", { method: "GET", url: "/v1/%c0" }, 404],
  ["public route", { method: "GET", url: "/v1/meta" }, 200],
  ["liveness probe", { method: "GET", url: "/health/live" }, 200],
  ["readiness probe", { method: "GET", url: "/health/ready" }, 200],
  [
    "write from another site (403 ORIGIN_NOT_ALLOWED)",
    {
      method: "POST",
      url: "/v1/things",
      headers: { ...principalHeader(), ...json, origin: "https://evil.example" },
      payload: { name: "n" },
    },
    403,
  ],
];

describe("NFR-14 FR 1: the security headers of the table on every API response", () => {
  it.each(CASES)("%s", async (where, request, status) => {
    const server = await serve();
    const response = await server.inject(request);
    expect(response.statusCode).toBe(status);
    expectApiHeaders(response, where);
  });

  it("the kill switch's 503, a not-ready probe and an over-long path parameter carry them too", async () => {
    const server = await serve({
      readiness: async () => ({ ready: false, reason: "schema-behind" }),
      api: { moduleState: async () => "killed" },
    });
    const killed = await server.inject({ method: "GET", url: "/v1/things/a", headers: principalHeader() });
    expect(killed.statusCode).toBe(503);
    expectApiHeaders(killed, "kill switch");
    const notReady = await server.inject({ method: "GET", url: "/health/ready" });
    expect(notReady.statusCode).toBe(503);
    expectApiHeaders(notReady, "not ready");
    const long = await server.inject({ method: "GET", url: `/v1/things/${"a".repeat(200)}` });
    expect(long.statusCode).toBe(404);
    expectApiHeaders(long, "max param length");
  });

  it("the 503 of a request that arrives while the server stops carries them", async () => {
    const server = await serve();
    await server.listen({ host: "127.0.0.1", port: 0 });
    const { port } = server.server.address() as AddressInfo;
    let raw = "";
    const socket = connect(port, "127.0.0.1");
    await new Promise<void>((r) => socket.once("connect", () => r()));
    const ended = new Promise<void>((r) => socket.on("close", () => r()));
    socket.on("data", (d) => (raw += d.toString("utf8")));
    socket.write("GET /v1/things/b HTTP/1.1\r\nhost: x\r\n");
    await new Promise((r) => setTimeout(r, 20));
    const closed = server.close();
    await new Promise((r) => setTimeout(r, 20));
    socket.write("\r\n");
    await ended;
    await closed;
    app = undefined;
    expect(raw).toMatch(/^HTTP\/1\.1 503 /);
    const head = raw.slice(0, raw.indexOf("\r\n\r\n")).toLowerCase();
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS))
      expect(head).toContain(`${name}: ${value.toLowerCase()}`);
  });

  it("429 RATE_LIMITED carries them", async () => {
    const server = await serve();
    for (let i = 0; i < 60; i++) await server.inject({ method: "GET", url: "/v1/meta" });
    const refused = await server.inject({ method: "GET", url: "/v1/meta" });
    expect(refused.statusCode).toBe(429);
    expectApiHeaders(refused, "429");
  });

  it("HSTS only when the server is told it runs in staging or production", async () => {
    const server = await serve({ hsts: true });
    for (const [where, request] of CASES) expectApiHeaders(await server.inject(request), where, true);
    await server.close();
    const local = await serve({ hsts: false });
    expectApiHeaders(await local.inject({ method: "GET", url: "/health/live" }), "local");
  });
});

describe("NFR-14 FR 1: a route's own header value has priority", () => {
  it("its successful answer carries its values; the other headers stay the defaults", async () => {
    const server = await serve({ hsts: true });
    const response = await server.inject({
      method: "GET",
      url: "/v1/thing-types/t1/schema",
      headers: principalHeader(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, max-age=300");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["content-security-policy"]).toBe(
      "default-src 'none'; frame-ancestors 'self'; sandbox",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(response.headers[HSTS_HEADER]).toBe(HSTS_VALUE);
  });

  it("a problem of that route keeps the defaults (an error is never cached)", async () => {
    const server = await serve();
    const response = await server.inject({
      method: "GET",
      url: "/v1/thing-types/fail/schema",
      headers: principalHeader(),
    });
    expect(response.statusCode).toBe(500);
    expectApiHeaders(response, "route problem");
  });

  it("a route cannot set a header outside the overridable ones, nor a value with a line break", () => {
    const base = {
      module: "things",
      method: "GET" as const,
      path: "/v1/things-x",
      operationId: "thingsX",
      summary: "x",
      access,
      response: { status: 200 as const, description: "x", schema: z.object({ ok: z.boolean() }) },
      handler: async () => ({ ok: true }),
    };
    expect(() => defineRoute({ ...base, headers: { "x-content-type-options": "none" } as never })).toThrow(
      /cannot be set by a route/,
    );
    expect(() =>
      defineRoute({ ...base, headers: { "strict-transport-security": "max-age=0" } as never }),
    ).toThrow(/cannot be set by a route/);
    expect(() =>
      defineRoute({ ...base, headers: { "cache-control": "no-store\r\nset-cookie: x=y" } }),
    ).toThrow(/invalid value/);
  });
});

describe("NFR-14 AC2 / FR 3: API answers with financial data are not stored and cannot be framed; no web CSP", () => {
  it("Cache-Control no-store, X-Frame-Options DENY, frame-ancestors 'none'; the CSP is the API's, not the web's", async () => {
    const server = await serve();
    const response = await server.inject({ method: "GET", url: "/v1/things/a", headers: principalHeader() });
    expect(response.json()).toEqual({ amount: "1234.56" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    const csp = String(response.headers["content-security-policy"]);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'none'");
    // The web policy (script-src 'self' …) is never sent by the API.
    expect(csp).not.toMatch(/script-src|'self'/);
  });
});
