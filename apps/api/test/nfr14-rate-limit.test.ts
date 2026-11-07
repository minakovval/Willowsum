import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerApi, type ApiOptions } from "../src/platform/http/api.ts";
import { metaRoute } from "../src/platform/http/meta.ts";
import {
  createApiRateLimits,
  memoryRateLimitStore,
  RATE_LIMITS,
  RATE_LIMIT_WINDOW_MS,
  reportRateLimitOverflow,
} from "../src/platform/http/rate-limit.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { exportedText, testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { principalHeader, testApiOptions } from "./http.ts";

/**
 * NFR-14 FR 5–10, AC1 and criterion «Обмеження частоти»: per client address, fixed one-minute windows —
 * public 60, uploads 30, the rest 600; 429 RATE_LIMITED with Retry-After; the address only from trusted
 * proxies; counted without the address in telemetry; a 429 is not a server error.
 */
const telemetry = testTelemetryForFile();

const access = { permission: "things.read", feature: "things" };
const getThing = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things/{thingId}",
  operationId: "getThingLimited",
  summary: "x",
  access,
  request: { params: z.object({ thingId: z.string() }) },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});
const uploadThing = defineRoute({
  module: "things",
  method: "POST",
  path: "/v1/things/{thingId}/files",
  operationId: "uploadThingFileLimited",
  summary: "x",
  access: { ...access, flag: "things.files" },
  rateLimit: "upload",
  request: { params: z.object({ thingId: z.string() }) },
  response: { status: 201, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});
const routes = [metaRoute, getThing, uploadThing];

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const CLIENT = "203.0.113.77";
const OTHER = "198.51.100.23";

async function serve(
  options: { api?: Partial<ApiOptions>; trustedProxyHops?: number; now?: () => number } = {},
): Promise<FastifyInstance> {
  app = buildServer({
    readiness: async () => ({ ready: true }),
    ...(options.trustedProxyHops !== undefined ? { trustedProxyHops: options.trustedProxyHops } : {}),
    api: (a) =>
      registerApi(
        a,
        testApiOptions(routes, {
          rateLimits: createApiRateLimits(options.now ? { now: options.now } : {}),
          ...options.api,
        }),
      ),
  });
  await app.ready();
  return app;
}

async function send(server: FastifyInstance, request: InjectOptions, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) statuses.push((await server.inject(request)).statusCode);
  return statuses;
}

/** The middle of a window, so a test never straddles two. */
const fixedNow = () => Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS + 15_000;

describe("NFR-14 AC1 / FR 5–6: the 61st public request in a minute gets 429 RATE_LIMITED with Retry-After", () => {
  it("60 pass, the 61st is 429 with the problem code and Retry-After = seconds to the end of the window", async () => {
    const server = await serve({ now: fixedNow });
    const meta = { method: "GET" as const, url: "/v1/meta", remoteAddress: CLIENT };
    expect(await send(server, meta, RATE_LIMITS.public)).toEqual(Array(60).fill(200));
    const refused = await server.inject(meta);
    expect(refused.statusCode).toBe(429);
    expect(refused.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(refused.json()).toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(refused.headers["retry-after"]).toBe("45");
  });

  it("another client address has its own counter", async () => {
    const server = await serve({ now: fixedNow });
    await send(server, { method: "GET", url: "/v1/meta", remoteAddress: CLIENT }, 61);
    expect((await server.inject({ method: "GET", url: "/v1/meta", remoteAddress: OTHER })).statusCode).toBe(
      200,
    );
  });

  it("the next window starts from zero (fixed one-minute windows)", async () => {
    let now = fixedNow();
    const server = await serve({ now: () => now });
    const meta = { method: "GET" as const, url: "/v1/meta", remoteAddress: CLIENT };
    await send(server, meta, 61);
    now += RATE_LIMIT_WINDOW_MS;
    expect((await server.inject(meta)).statusCode).toBe(200);
  });
});

describe("NFR-14 FR 5: the rest of the API 600 per minute; uploads 30", () => {
  it("protected routes and unknown paths share the `default` class: the 601st is 429 (a 429 never tells them apart)", async () => {
    const server = await serve({ now: fixedNow });
    const read = {
      method: "GET" as const,
      url: "/v1/things/a",
      headers: principalHeader(),
      remoteAddress: CLIENT,
    };
    const unknown = { method: "GET" as const, url: "/v1/no-such-path", remoteAddress: CLIENT };
    expect(new Set(await send(server, read, 300))).toEqual(new Set([200]));
    expect(new Set(await send(server, unknown, 300))).toEqual(new Set([404]));
    expect((await server.inject(read)).statusCode).toBe(429);
    expect((await server.inject(unknown)).statusCode).toBe(429);
    // The public class is separate.
    expect((await server.inject({ method: "GET", url: "/v1/meta", remoteAddress: CLIENT })).statusCode).toBe(
      200,
    );
  });

  it("an upload route: the 31st upload in a minute is 429", async () => {
    const server = await serve({ now: fixedNow });
    const upload = {
      method: "POST" as const,
      url: "/v1/things/a/files",
      headers: principalHeader(),
      remoteAddress: CLIENT,
    };
    expect(await send(server, upload, RATE_LIMITS.upload)).toEqual(Array(30).fill(201));
    expect((await server.inject(upload)).statusCode).toBe(429);
  });

  it("an upload function that is off for the space stays 404 — its own limit never shows that it exists", async () => {
    const server = await serve({
      now: fixedNow,
      api: { checkFlag: async (_p, flag) => flag !== "things.files" },
    });
    const upload = {
      method: "POST" as const,
      url: "/v1/things/a/files",
      headers: principalHeader(),
      remoteAddress: CLIENT,
    };
    expect(new Set(await send(server, upload, 40))).toEqual(new Set([404]));
  });

  it("health probes are not API requests and are never limited", async () => {
    const server = await serve({ now: fixedNow });
    const statuses = await send(server, { method: "GET", url: "/health/live", remoteAddress: CLIENT }, 700);
    expect(new Set(statuses)).toEqual(new Set([200]));
  });

  it("a route may only be stricter than its default class", () => {
    const base = {
      method: "GET" as const,
      path: "/v1/things-y",
      operationId: "thingsY",
      summary: "x",
      response: { status: 200 as const, description: "x", schema: z.object({ ok: z.boolean() }) },
      handler: async () => ({ ok: true }),
    };
    expect(() =>
      defineRoute({ ...base, module: null, access: { public: "webhook" }, rateLimit: "default" }),
    ).toThrow(/looser/);
    expect(() =>
      defineRoute({ ...base, module: null, access: { public: "signed upload" }, rateLimit: "upload" }),
    ).not.toThrow();
    expect(() => defineRoute({ ...base, module: "things", access, rateLimit: "public" })).not.toThrow();
  });
});

describe("NFR-14 FR 8: the client address only through trusted proxies", () => {
  it("with no trusted proxy (default 0) X-Forwarded-For is ignored: rotating it does not escape the limit", async () => {
    const server = await serve({ now: fixedNow });
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++)
      statuses.push(
        (
          await server.inject({
            method: "GET",
            url: "/v1/meta",
            remoteAddress: CLIENT,
            headers: { "x-forwarded-for": `192.0.2.${i}` },
          })
        ).statusCode,
      );
    expect(statuses.at(-1)).toBe(429);
  });

  it("with one trusted proxy the client is the last X-Forwarded-For entry; entries the client added are ignored", async () => {
    const server = await serve({ now: fixedNow, trustedProxyHops: 1 });
    const proxy = "10.0.0.5";
    const statuses: number[] = [];
    // The client forges earlier entries; the proxy appends the address it saw (CLIENT).
    for (let i = 0; i < 61; i++)
      statuses.push(
        (
          await server.inject({
            method: "GET",
            url: "/v1/meta",
            remoteAddress: proxy,
            headers: { "x-forwarded-for": `192.0.2.${i}, ${CLIENT}` },
          })
        ).statusCode,
      );
    expect(statuses.at(-1)).toBe(429);
    // Another real client behind the same proxy is counted on its own.
    const other = await server.inject({
      method: "GET",
      url: "/v1/meta",
      remoteAddress: proxy,
      headers: { "x-forwarded-for": OTHER },
    });
    expect(other.statusCode).toBe(200);
  });
});

describe("NFR-14 FR 8: a proxy that writes the client as ip:port", () => {
  it("the port is dropped: one client on many ports is one counter; two clients stay apart", async () => {
    const server = await serve({ now: fixedNow, trustedProxyHops: 1 });
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++)
      statuses.push(
        (
          await server.inject({
            method: "GET",
            url: "/v1/meta",
            remoteAddress: "10.0.0.5",
            headers: { "x-forwarded-for": `${CLIENT}:${40_000 + i}` },
          })
        ).statusCode,
      );
    expect(statuses.at(-1)).toBe(429);
    const other = await server.inject({
      method: "GET",
      url: "/v1/meta",
      remoteAddress: "10.0.0.5",
      headers: { "x-forwarded-for": `${OTHER}:40000` },
    });
    expect(other.statusCode).toBe(200);
  });
});

describe("NFR-14 FR 9: limits are off only when the API is explicitly told so (load test)", () => {
  it('rateLimits: "off" lets every request through; omitted, the limits are on', async () => {
    const off = await serve({ api: { rateLimits: "off" } });
    expect(new Set(await send(off, { method: "GET", url: "/v1/meta", remoteAddress: CLIENT }, 70))).toEqual(
      new Set([200]),
    );
    await off.close();
    app = buildServer({
      readiness: async () => ({ ready: true }),
      api: (a) => {
        const options = testApiOptions(routes);
        expect(options.rateLimits).toBeUndefined();
        registerApi(a, options);
      },
    });
    await app.ready();
    const statuses = await send(app, { method: "GET", url: "/v1/meta", remoteAddress: CLIENT }, 61);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("NFR-14 FR 6 / ARC-09: a rejection is counted without the client address and is not a server error", () => {
  it("ws.rate_limit.rejections by class and route; the address appears nowhere in telemetry; the span is not an error", async () => {
    // The counter is cumulative over the file: compare before and after.
    const publicRejections = async (): Promise<number> => {
      await telemetry.forceFlush();
      const points = telemetry.memory
        .resourceMetrics()
        .flatMap((m) => m.scopeMetrics.flatMap((s) => s.metrics))
        .filter((m) => m.descriptor.name === "ws.rate_limit.rejections")
        .flatMap((m) => m.dataPoints as { attributes: Record<string, unknown>; value: unknown }[]);
      // Only the class and the route template label the counter: never an address.
      for (const p of points)
        for (const key of Object.keys(p.attributes))
          expect(["ws.rate_limit.class", "http.route"]).toContain(key);
      const last = points.filter(
        (p) => p.attributes["ws.rate_limit.class"] === "public" && p.attributes["http.route"] === "/v1/meta",
      );
      return (last.at(-1)?.value as number | undefined) ?? 0;
    };
    const before = await publicRejections();
    const server = await serve({ now: fixedNow });
    await send(server, { method: "GET", url: "/v1/meta", remoteAddress: CLIENT }, 62);
    expect((await publicRejections()) - before).toBe(2);
    const span = telemetry.memory
      .finishedSpans()
      .filter((s) => s.kind === SpanKind.SERVER)
      .at(-1)!;
    expect(span.attributes).toMatchObject({
      "http.response.status_code": 429,
      "ws.problem.code": "RATE_LIMITED",
    });
    expect(span.status.code).not.toBe(SpanStatusCode.ERROR);
    const text = await exportedText(telemetry);
    expect(text).not.toContain(CLIENT);
    expect(text).not.toContain("203.0.113");
  });
});

describe("NFR-14 (review of PR #86): an overflowing in-memory store is visible in telemetry, without addresses", () => {
  it("every overflowed hit is counted by class; one log entry per class per window", async () => {
    const overflowPoints = async (): Promise<number> => {
      await telemetry.forceFlush();
      const points = telemetry.memory
        .resourceMetrics()
        .flatMap((m) => m.scopeMetrics.flatMap((s) => s.metrics))
        .filter((m) => m.descriptor.name === "ws.rate_limit.overflow")
        .flatMap((m) => m.dataPoints as { attributes: Record<string, unknown>; value: unknown }[]);
      for (const p of points) expect(Object.keys(p.attributes)).toEqual(["ws.rate_limit.class"]);
      return (points.find((p) => p.attributes["ws.rate_limit.class"] === "public")?.value as number) ?? 0;
    };
    const before = await overflowPoints();
    const store = memoryRateLimitStore({ maxKeys: 2, onOverflow: reportRateLimitOverflow });
    const limits = createApiRateLimits({ store, now: fixedNow });
    for (const address of [CLIENT, OTHER, "192.0.2.1", "192.0.2.2", "192.0.2.3"])
      await limits.limiters.public.hit(`public:${address}`);
    expect((await overflowPoints()) - before).toBe(3);
    const logs = telemetry.memory.logRecords().filter((r) => r.eventName === "rate_limit.overflow");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.attributes).toEqual({ "ws.rate_limit.class": "public" });
    const text = await exportedText(telemetry);
    for (const address of [CLIENT, OTHER, "192.0.2.3"]) expect(text).not.toContain(address);
  });
});
