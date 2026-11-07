import { connect, type AddressInfo } from "node:net";
import type { FastifyInstance, FastifyReply, InjectOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerApi, type ApiOptions } from "../src/platform/http/api.ts";
import { metaRoute } from "../src/platform/http/meta.ts";
import { parseAllowedOrigins } from "../src/platform/http/origin.ts";
import { createApiRateLimits, RATE_LIMIT_WINDOW_MS } from "../src/platform/http/rate-limit.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import {
  API_SECURITY_HEADERS,
  applySecurityHeaders,
  HSTS_HEADER,
  HSTS_VALUE,
} from "../src/platform/http/security-headers.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { principalHeader, testApiOptions } from "./http.ts";

/**
 * Security review of PR #86 (NFR-14 FR 1, table «Заголовки API»): the headers on response paths the PR's own
 * tests do not reach — HEAD and other methods, a route's own values never on its problems (401, 403, 404 of a
 * hidden function, 400, 429), the idempotent replay, nosniff and HSTS that nothing can relax, and the answers
 * Node writes itself for a request it cannot parse.
 */
const WEB = "https://app.willowsum.example";
const access = { permission: "things.read", feature: "things" };
const OVERRIDES = {
  "cache-control": "private, max-age=300",
  "x-frame-options": "SAMEORIGIN",
  "content-security-policy": "default-src 'none'; frame-ancestors 'self'; sandbox",
  "cross-origin-resource-policy": "same-site",
  "referrer-policy": "same-origin",
} as const;

const getThing = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things/{thingId}",
  operationId: "getThingSec86",
  summary: "x",
  access,
  request: { params: z.object({ thingId: z.string() }) },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});

/** A create route with its own header values and a flag (a function that can be off for a space). */
const createDoc = defineRoute({
  module: "things",
  method: "POST",
  path: "/v1/docs",
  operationId: "createDocSec86",
  summary: "x",
  access: { ...access, flag: "things.docs" },
  create: true,
  headers: OVERRIDES,
  request: { body: z.object({ name: z.string() }) },
  response: { status: 201, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});

/** A read route with its own values: the most common override (a cacheable schema). */
const getSchema = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/doc-types/{typeId}",
  operationId: "getDocTypeSec86",
  summary: "x",
  access: { ...access, flag: "things.docs" },
  headers: OVERRIDES,
  request: { params: z.object({ typeId: z.string().max(5) }) },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});

const routes = [metaRoute, getThing, createDoc, getSchema];

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const middle = () => Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS + 20_000;

async function serve(options: { hsts?: boolean; api?: Partial<ApiOptions> } = {}): Promise<FastifyInstance> {
  app = buildServer({
    readiness: async () => ({ ready: true }),
    ...(options.hsts !== undefined ? { hsts: options.hsts } : {}),
    api: (a) =>
      registerApi(
        a,
        testApiOptions(routes, {
          allowedOrigins: parseAllowedOrigins(WEB)!,
          rateLimits: createApiRateLimits({ now: middle }),
          ...options.api,
        }),
      ),
  });
  await app.ready();
  return app;
}

function expectDefaults(headers: Record<string, unknown>, where: string, hsts = false): void {
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS))
    expect(headers[name], `${where}: ${name}`).toBe(value);
  if (hsts) expect(headers[HSTS_HEADER], `${where}: HSTS`).toBe(HSTS_VALUE);
  else expect(headers[HSTS_HEADER], `${where}: no HSTS`).toBeUndefined();
}

const json = { "content-type": "application/json" };

describe("NFR-14 FR 1: other methods and HEAD carry the headers too", () => {
  it.each<[string, InjectOptions]>([
    ["HEAD of a protected read", { method: "HEAD", url: "/v1/things/a", headers: principalHeader() }],
    ["HEAD of a public route", { method: "HEAD", url: "/v1/meta" }],
    ["OPTIONS (no CORS preflight is served)", { method: "OPTIONS", url: "/v1/meta" }],
    ["TRACE", { method: "TRACE", url: "/v1/meta" }],
    ["a method the path does not have", { method: "PUT", url: "/v1/meta" }],
    ["HEAD of a probe", { method: "HEAD", url: "/health/live" }],
  ])("%s", async (where, request) => {
    const server = await serve({ hsts: true });
    const response = await server.inject(request);
    expectDefaults(response.headers, where, true);
    // No CORS: the API never lets another origin read its answers.
    expect(response.headers["access-control-allow-origin"], where).toBeUndefined();
  });
});

describe("NFR-14 FR 1: a route's own values apply to its successful answers only", () => {
  const create = (headers: Record<string, string>, payload: unknown = { name: "n" }): InjectOptions =>
    ({
      method: "POST",
      url: "/v1/docs",
      headers: { ...json, ...headers },
      payload: payload as InjectOptions["payload"],
    }) as InjectOptions;

  it("its 201 carries them (control), and nosniff stays", async () => {
    const server = await serve();
    const ok = await server.inject(create({ ...principalHeader(), origin: WEB }));
    expect(ok.statusCode).toBe(201);
    expect(ok.headers).toMatchObject(OVERRIDES);
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
  });

  it.each<[string, Partial<ApiOptions>, Record<string, string>, unknown, number]>([
    ["401 without a session", {}, {}, { name: "n" }, 401],
    [
      "403 ORIGIN_NOT_ALLOWED",
      {},
      { ...principalHeader(), origin: "https://evil.example" },
      { name: "n" },
      403,
    ],
    ["403 FORBIDDEN (role)", { checkPermission: () => false }, principalHeader(), { name: "n" }, 403],
    [
      "404 of a function off for the space",
      { checkFlag: async () => false },
      principalHeader(),
      { name: "n" },
      404,
    ],
    ["400 invalid body", {}, principalHeader(), { name: 1 }, 400],
    ["503 kill switch", { moduleState: async () => "killed" }, principalHeader(), { name: "n" }, 503],
  ])("%s keeps the defaults", async (where, api, headers, payload, status) => {
    const server = await serve({ api });
    const response = await server.inject(create(headers, payload));
    expect(response.statusCode, where).toBe(status);
    expectDefaults(response.headers, where);
  });

  it("a read route's 429 and 400 keep the defaults (an error is never cached for 5 minutes)", async () => {
    const server = await serve();
    const bad = await server.inject({
      method: "GET",
      url: "/v1/doc-types/toolong",
      headers: principalHeader(),
    });
    expect(bad.statusCode).toBe(400);
    expectDefaults(bad.headers, "400");
    let last = bad;
    for (let i = 0; i < 600 && last.statusCode !== 429; i++)
      last = await server.inject({ method: "GET", url: "/v1/doc-types/t", headers: principalHeader() });
    expect(last.statusCode).toBe(429);
    expectDefaults(last.headers, "429");
  });

  it("the idempotent replay of a create carries the route's values, like the first answer", async () => {
    const server = await serve();
    const request = create({ ...principalHeader(), origin: WEB, "idempotency-key": "sec86-replay-1" });
    const first = await server.inject(request);
    const replay = await server.inject(request);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    for (const name of Object.keys(OVERRIDES)) expect(replay.headers[name], name).toBe(first.headers[name]);
  });
});

/** A reply stand-in with the header API that applySecurityHeaders uses. */
function fakeReply(preset: Record<string, string>): { reply: FastifyReply; headers: Record<string, string> } {
  const headers: Record<string, string> = { ...preset };
  const reply = {
    hasHeader: (n: string) => n in headers,
    header: (n: string, v: string) => {
      headers[n] = v;
      return reply;
    },
    removeHeader: (n: string) => {
      delete headers[n];
      return reply;
    },
  } as unknown as FastifyReply;
  return { reply, headers };
}

describe("NFR-14 FR 1 / ADR-0007: nosniff and HSTS cannot be relaxed by anything set earlier", () => {
  it("a nosniff value set before the hook is replaced by the platform's", () => {
    const { reply, headers } = fakeReply({ "x-content-type-options": "sniff-please" });
    applySecurityHeaders(reply, { hsts: false });
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });

  it("HSTS: a weaker value is replaced in staging/production, and removed locally", () => {
    const deployed = fakeReply({ [HSTS_HEADER]: "max-age=0" });
    applySecurityHeaders(deployed.reply, { hsts: true });
    expect(deployed.headers[HSTS_HEADER]).toBe(HSTS_VALUE);
    const local = fakeReply({ [HSTS_HEADER]: "max-age=0" });
    applySecurityHeaders(local.reply, { hsts: false });
    expect(local.headers[HSTS_HEADER]).toBeUndefined();
  });
});

async function raw(port: number, text: string): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    const socket = connect(port, "127.0.0.1", () => socket.write(text));
    socket.on("data", (d) => (out += d.toString("latin1")));
    socket.on("close", () => resolve(out));
    socket.on("error", () => resolve(out));
    setTimeout(() => socket.destroy(), 1_000);
  });
}

describe("NFR-14 FR 1, criterion «100 % відповідей»: requests Node cannot parse", () => {
  // Was a defect (review of PR #86): Fastify's default clientErrorHandler wrote these answers without the
  // security headers (a browser reaches the 431 with an oversized cookie). Fixed: buildServer's own handler.
  it.each([
    ["400: a method in lower case", "post /v1/meta HTTP/1.1\r\nhost: x\r\ncontent-length: 0\r\n\r\n", 400],
    ["400: a header name with a space", "GET /v1/meta HTTP/1.1\r\nhost: x\r\nbad header: y\r\n\r\n", 400],
    [
      "431: headers too large",
      `GET /v1/meta HTTP/1.1\r\nhost: x\r\nx-big: ${"a".repeat(20_000)}\r\n\r\n`,
      431,
    ],
  ])("%s carries the security headers", async (_where, request, status) => {
    const server = await serve({ hsts: true });
    await server.listen({ host: "127.0.0.1", port: 0 });
    const { port } = server.server.address() as AddressInfo;
    const answer = await raw(port, request);
    expect(answer).toMatch(new RegExp(`^HTTP/1\\.1 ${status} `));
    const head = answer.slice(0, answer.indexOf("\r\n\r\n")).toLowerCase();
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS))
      expect(head).toContain(`\r\n${name}: ${value.toLowerCase()}`);
    expect(head).toContain(`\r\n${HSTS_HEADER}: ${HSTS_VALUE.toLowerCase()}`);
  });
});
