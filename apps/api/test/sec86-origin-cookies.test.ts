import { connect, type AddressInfo } from "node:net";
import type { FastifyInstance, FastifyRequest, InjectOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerApi, type ApiOptions } from "../src/platform/http/api.ts";
import { cookieContext, readSessionCookie, SECURE_COOKIE_PREFIX } from "../src/platform/http/cookies.ts";
import { metaRoute } from "../src/platform/http/meta.ts";
import { parseAllowedOrigins } from "../src/platform/http/origin.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { principalHeader, testApiOptions } from "./http.ts";

/**
 * Security review of PR #86 (NFR-15 FR 5): every write method, method-override headers, non-canonical and
 * repeated Origin values, Sec-Fetch-Site values, the configuration's parsing; session cookies read only
 * under the exact prefixed name and only with a valid value; HTTPS for cookies only through a trusted proxy.
 */
const WEB = "https://app.willowsum.example";
const access = { permission: "things.write", feature: "things" };
let handled = 0;
const body = { body: z.object({ name: z.string() }) };
const ok = { status: 200 as const, description: "x", schema: z.object({ ok: z.boolean() }) };
const writes = (["POST", "PUT", "PATCH", "DELETE"] as const).map((method) =>
  defineRoute({
    module: "things",
    method,
    path: "/v1/things/{thingId}",
    operationId: `write${method}Sec86`,
    summary: "x",
    access,
    request: { params: z.object({ thingId: z.string() }), ...(method === "DELETE" ? {} : body) },
    response: ok,
    handler: async () => {
      handled += 1;
      return { ok: true };
    },
  }),
);
const read = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things/{thingId}",
  operationId: "readSec86",
  summary: "x",
  access: { permission: "things.read", feature: "things" },
  request: { params: z.object({ thingId: z.string() }) },
  response: ok,
  handler: async () => ({ ok: true }),
});

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function serve(options: { api?: Partial<ApiOptions>; trustedProxyHops?: number } = {}) {
  app = buildServer({
    readiness: async () => ({ ready: true }),
    ...(options.trustedProxyHops !== undefined ? { trustedProxyHops: options.trustedProxyHops } : {}),
    api: (a) =>
      registerApi(
        a,
        testApiOptions([metaRoute, read, ...writes], {
          allowedOrigins: parseAllowedOrigins(WEB)!,
          rateLimits: "off",
          ...options.api,
        }),
      ),
  });
  await app.ready();
  return app;
}

const write = (method: string, headers: Record<string, string>): InjectOptions =>
  ({
    method: method as InjectOptions["method"],
    url: "/v1/things/a",
    headers: {
      ...principalHeader(),
      ...(method === "DELETE" ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(method === "DELETE" ? {} : { payload: { name: "n" } }),
  }) as InjectOptions;

describe("NFR-15 FR 5: every write method is checked", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "%s from another site → 403; from the web app → 200",
    async (method) => {
      const server = await serve();
      const before = handled;
      const refused = await server.inject(write(method, { origin: "https://evil.example" }));
      expect(refused.statusCode).toBe(403);
      expect(refused.json().code).toBe("ORIGIN_NOT_ALLOWED");
      expect(handled).toBe(before);
      expect((await server.inject(write(method, { origin: WEB }))).statusCode).toBe(200);
    },
  );

  it("method-override headers change nothing: a POST that claims to be a GET is still a checked write", async () => {
    const server = await serve();
    for (const header of ["x-http-method-override", "x-http-method", "x-method-override"]) {
      const response = await server.inject(
        write("POST", { origin: "https://evil.example", [header]: "GET" }),
      );
      expect(response.statusCode, header).toBe(403);
    }
  });

  it("reads with another site's Origin are answered (HEAD, GET); OPTIONS is no preflight that grants anything", async () => {
    const server = await serve();
    const evil = { ...principalHeader(), origin: "https://evil.example" };
    expect((await server.inject({ method: "GET", url: "/v1/things/a", headers: evil })).statusCode).toBe(200);
    expect((await server.inject({ method: "HEAD", url: "/v1/things/a", headers: evil })).statusCode).toBe(
      200,
    );
    const options = await server.inject({ method: "OPTIONS", url: "/v1/things/a", headers: evil });
    expect(options.statusCode).toBe(404);
    expect(options.headers["access-control-allow-origin"]).toBeUndefined();
    expect(options.headers["access-control-allow-methods"]).toBeUndefined();
  });
});

describe("NFR-15 FR 5: only the exact serialisation of an allowed origin passes", () => {
  it.each([
    ["upper case", WEB.toUpperCase()],
    ["mixed-case host", "https://App.Willowsum.Example"],
    ["trailing slash", `${WEB}/`],
    ["with a path", `${WEB}/x`],
    ["the default port spelled out", `${WEB}:443`],
    ["two values in one header", `${WEB}, https://evil.example`],
    ["the string null", "null"],
  ])("%s → 403", async (_where, origin) => {
    const server = await serve();
    expect((await server.inject(write("POST", { origin }))).statusCode).toBe(403);
  });

  it("several Origin headers on the wire (allowed one first) → 403", async () => {
    const server = await serve();
    await server.listen({ host: "127.0.0.1", port: 0 });
    const { port } = server.server.address() as AddressInfo;
    const answer = await new Promise<string>((resolve) => {
      let out = "";
      const socket = connect(port, "127.0.0.1", () =>
        socket.write(
          `POST /v1/things/a HTTP/1.1\r\nhost: x\r\norigin: ${WEB}\r\norigin: https://evil.example\r\n` +
            `content-type: application/json\r\ncontent-length: 12\r\nconnection: close\r\n` +
            `${Object.entries(principalHeader())
              .map(([n, v]) => `${n}: ${v}\r\n`)
              .join("")}\r\n{"name":"n"}`,
        ),
      );
      socket.on("data", (d) => (out += d.toString()));
      socket.on("close", () => resolve(out));
    });
    expect(answer).toMatch(/^HTTP\/1\.1 403 /);
  });
});

describe("NFR-15 FR 5: Sec-Fetch-Site without Origin", () => {
  it.each([
    ["none (the user typed the address)", "none", 200],
    ["same-origin", "same-origin", 200],
    ["cross-site", "cross-site", 403],
    ["same-site", "same-site", 403],
    ["an unknown value", "sideways", 403],
    ["cross-site in other case", "Cross-Site", 403],
  ])("%s → %d", async (_where, site, status) => {
    const server = await serve();
    expect((await server.inject(write("PUT", { "sec-fetch-site": site }))).statusCode).toBe(status);
  });
});

describe("NFR-15 FR 5: WS_ALLOWED_ORIGINS parsing", () => {
  it("accepts exact origins with spaces around the commas; refuses non-canonical, wildcard or private-network http", () => {
    expect([...parseAllowedOrigins(" https://a.example ,https://b.example:8443,, ")!]).toEqual([
      "https://a.example",
      "https://b.example:8443",
    ]);
    expect(parseAllowedOrigins("http://127.0.0.1:5173")).toBeDefined();
    expect(parseAllowedOrigins("http://[::1]:5173")).toBeDefined();
    for (const bad of [
      "HTTPS://A.EXAMPLE",
      "https://a.example:443",
      "https://a.example?x",
      "https://a.example#x",
      "http://192.168.1.10:5173",
      "http://localhost.evil.example",
      "https://*",
      "*.example",
      "https://a.example, *",
      "null",
      "file://",
      "https://a b.example",
    ])
      expect(parseAllowedOrigins(bad), bad).toBeUndefined();
  });
});

describe("NFR-15 FR 5: session cookies are read only under their exact name, with a valid value", () => {
  const https = { https: true };
  const value = "v".repeat(20);
  const headers = (cookie: string) => ({ headers: { cookie } });

  it("on HTTPS a case variant of the prefix is not the session cookie", () => {
    expect(readSessionCookie(headers(`__secure-ws_session=${value}`), "ws_session", https)).toBeUndefined();
    expect(readSessionCookie(headers(`__SECURE-ws_session=${value}`), "ws_session", https)).toBeUndefined();
    expect(readSessionCookie(headers(`__Secure-WS_SESSION=${value}`), "ws_session", https)).toBeUndefined();
  });

  it("a value a cookie cannot legally hold (quotes, comma, backslash, empty) is not returned", () => {
    for (const bad of [`"${value}"`, `${value},x`, `${value}\\`, ""])
      expect(
        readSessionCookie(headers(`${SECURE_COOKIE_PREFIX}ws_session=${bad}`), "ws_session", https),
        bad,
      ).toBeUndefined();
  });

  it("HTTPS for cookies comes from X-Forwarded-Proto only through a trusted proxy", async () => {
    const seen: boolean[] = [];
    for (const hops of [0, 1]) {
      const server = buildServer({
        readiness: async () => ({ ready: true }),
        trustedProxyHops: hops,
        api: (a) => {
          a.addHook("onRequest", async (request: FastifyRequest) => {
            if (request.url === "/v1/meta") seen.push(cookieContext(request, false).https);
          });
          registerApi(a, testApiOptions([metaRoute], { rateLimits: "off" }));
        },
      });
      await server.ready();
      await server.inject({ method: "GET", url: "/v1/meta", headers: { "x-forwarded-proto": "https" } });
      await server.close();
    }
    expect(seen).toEqual([false, true]);
  });
});
