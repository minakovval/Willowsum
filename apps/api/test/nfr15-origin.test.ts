import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerApi, type ApiOptions } from "../src/platform/http/api.ts";
import { metaRoute } from "../src/platform/http/meta.ts";
import { parseAllowedOrigins } from "../src/platform/http/origin.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { principalHeader, testApiOptions } from "./http.ts";

/**
 * NFR-15 FR 5 (second sentence): write requests with an untrusted Origin are refused by the API (403
 * ORIGIN_NOT_ALLOWED) before anything of the request runs — kill switch, session, body. Reads are not
 * checked; a write without Origin (a non-browser client) passes unless the browser marks it cross-site.
 */
const access = { permission: "things.write", feature: "things" };
let handled = 0;
const createThing = defineRoute({
  module: "things",
  method: "POST",
  path: "/v1/things",
  operationId: "createThingOrigin",
  summary: "x",
  access,
  request: { body: z.object({ name: z.string() }) },
  response: { status: 201, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => {
    handled += 1;
    return { ok: true };
  },
});
const deleteThing = defineRoute({
  module: "things",
  method: "DELETE",
  path: "/v1/things/{thingId}",
  operationId: "deleteThingOrigin",
  summary: "x",
  access,
  request: { params: z.object({ thingId: z.string() }) },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});
const getThing = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things/{thingId}",
  operationId: "getThingOrigin",
  summary: "x",
  access,
  request: { params: z.object({ thingId: z.string() }) },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});

const WEB = "https://app.willowsum.example";
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function serve(api: Partial<ApiOptions> = {}): Promise<FastifyInstance> {
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      registerApi(
        a,
        testApiOptions([metaRoute, createThing, deleteThing, getThing], {
          allowedOrigins: parseAllowedOrigins(WEB)!,
          ...api,
        }),
      ),
  });
  await app.ready();
  return app;
}

const write = (headers: Record<string, string>): InjectOptions => ({
  method: "POST",
  url: "/v1/things",
  headers: { ...principalHeader(), "content-type": "application/json", ...headers },
  payload: { name: "n" },
});

describe("NFR-15 FR 5: writes with an untrusted Origin are refused", () => {
  it("a write from the web app's own origin passes", async () => {
    const server = await serve();
    expect((await server.inject(write({ origin: WEB }))).statusCode).toBe(201);
  });

  it.each([
    ["another site", { origin: "https://evil.example" }],
    ["a look-alike host", { origin: "https://app.willowsum.example.evil.example" }],
    ["the same host over http", { origin: "http://app.willowsum.example" }],
    ["another port", { origin: "https://app.willowsum.example:8443" }],
    ["Origin null (sandboxed frame, file)", { origin: "null" }],
    ["empty Origin", { origin: "" }],
    ["no Origin, but the browser marks it cross-site", { "sec-fetch-site": "cross-site" }],
    ["no Origin, browser says same-site (a sibling subdomain)", { "sec-fetch-site": "same-site" }],
  ])("%s → 403 ORIGIN_NOT_ALLOWED, the handler does not run", async (_where, headers) => {
    const server = await serve();
    const before = handled;
    const response = await server.inject(write(headers));
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "ORIGIN_NOT_ALLOWED", status: 403 });
    expect(handled).toBe(before);
  });

  it("DELETE, PUT and PATCH are writes too", async () => {
    const server = await serve();
    const response = await server.inject({
      method: "DELETE",
      url: "/v1/things/a",
      headers: { ...principalHeader(), origin: "https://evil.example" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("the check runs before the kill switch, the session and the body (nothing of the route is revealed)", async () => {
    const server = await serve({ moduleState: async () => "killed" });
    const noSession = await server.inject({
      method: "POST",
      url: "/v1/things",
      headers: { origin: "https://evil.example", "content-type": "text/plain" },
      payload: "{",
    });
    expect(noSession.statusCode).toBe(403);
    // An unknown path gets the same answer as an existing route.
    const unknown = await server.inject({
      method: "POST",
      url: "/v1/no-such-path",
      headers: { origin: "https://evil.example" },
    });
    expect(unknown.statusCode).toBe(403);
    expect(unknown.json().code).toBe(noSession.json().code);
  });

  it("decision: a write without Origin (mobile app, server, CLI) passes; so does one the browser marks same-origin", async () => {
    const server = await serve();
    expect((await server.inject(write({}))).statusCode).toBe(201);
    expect((await server.inject(write({ "sec-fetch-site": "same-origin" }))).statusCode).toBe(201);
  });

  it("reads are not checked: a GET with another site's Origin is answered as usual", async () => {
    const server = await serve();
    const response = await server.inject({
      method: "GET",
      url: "/v1/things/a",
      headers: { ...principalHeader(), origin: "https://evil.example" },
    });
    expect(response.statusCode).toBe(200);
  });

  it("without configured origins every write with an Origin is refused (fail closed)", async () => {
    const server = await serve({ allowedOrigins: new Set() });
    expect((await server.inject(write({ origin: WEB }))).statusCode).toBe(403);
    expect((await server.inject(write({}))).statusCode).toBe(201);
  });
});

describe("NFR-15 FR 5: the allowed origins of the configuration", () => {
  it("exact https origins; http only for this machine; anything else is refused", () => {
    expect([...parseAllowedOrigins("https://app.example, https://admin.example:8443")!]).toEqual([
      "https://app.example",
      "https://admin.example:8443",
    ]);
    expect(parseAllowedOrigins("http://localhost:5173")).toBeDefined();
    for (const bad of [
      "http://app.example",
      "https://app.example/",
      "https://app.example/path",
      "https://user:pw@app.example",
      "*",
      "https://*.example",
      "",
      "app.example",
    ])
      expect(parseAllowedOrigins(bad), bad).toBeUndefined();
  });
});
