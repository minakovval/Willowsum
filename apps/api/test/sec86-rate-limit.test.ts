import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerApi, type ApiOptions } from "../src/platform/http/api.ts";
import { metaRoute } from "../src/platform/http/meta.ts";
import {
  clientAddressKey,
  createApiRateLimits,
  createFixedWindowLimiter,
  memoryRateLimitStore,
  RATE_LIMIT_WINDOW_MS,
} from "../src/platform/http/rate-limit.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { principalHeader, testApiOptions } from "./http.ts";

/**
 * Security review of PR #86 (NFR-14 FR 5–8): what the PR's tests leave open — two trusted hops, malformed and
 * forged X-Forwarded-For, the textual forms of one IPv6 /64 and of a mapped IPv4 address, separate counters
 * per class, a public upload route, Retry-After at the window edge, the memory bound across windows, and no
 * client address in a refusal.
 */
const access = { permission: "things.read", feature: "things" };
const getThing = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things/{thingId}",
  operationId: "getThingSec86Rl",
  summary: "x",
  access,
  request: { params: z.object({ thingId: z.string() }) },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});
/** A public upload (e.g. a file sent through a signed link): 30 per minute, not 60. */
const publicUpload = defineRoute({
  module: null,
  method: "POST",
  path: "/v1/public-uploads",
  operationId: "publicUploadSec86",
  summary: "x",
  access: { public: "test: a signed upload link" },
  rateLimit: "upload",
  response: { status: 201, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});
const routes = [metaRoute, getThing, publicUpload];

const CLIENT = "203.0.113.77";
const PROXY = "10.0.0.5";
const OUTER = "10.0.0.9";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const middle = () => Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS + 20_000;

async function serve(
  options: { trustedProxyHops?: number; api?: Partial<ApiOptions> } = {},
): Promise<FastifyInstance> {
  app = buildServer({
    readiness: async () => ({ ready: true }),
    ...(options.trustedProxyHops !== undefined ? { trustedProxyHops: options.trustedProxyHops } : {}),
    api: (a) =>
      registerApi(
        a,
        testApiOptions(routes, { rateLimits: createApiRateLimits({ now: middle }), ...options.api }),
      ),
  });
  await app.ready();
  return app;
}

/** Sends `requests` in order and returns the statuses. */
async function statuses(server: FastifyInstance, requests: readonly InjectOptions[]): Promise<number[]> {
  const out: number[] = [];
  for (const r of requests) out.push((await server.inject(r)).statusCode);
  return out;
}

const meta = (remoteAddress: string, xff?: string): InjectOptions => ({
  method: "GET",
  url: "/v1/meta",
  remoteAddress,
  ...(xff !== undefined ? { headers: { "x-forwarded-for": xff } } : {}),
});

describe("NFR-14 FR 8: two trusted proxies", () => {
  it("the client is the second entry from the right; whatever the client prepends is ignored", async () => {
    const server = await serve({ trustedProxyHops: 2 });
    // Outer proxy appends the client, the inner proxy appends the outer one; the socket is the inner proxy.
    const forged = Array.from({ length: 61 }, (_, i) => meta(PROXY, `192.0.2.${i}, ${CLIENT}, ${OUTER}`));
    expect((await statuses(server, forged)).at(-1)).toBe(429);
    // Another client behind the same two proxies has its own counter.
    expect((await server.inject(meta(PROXY, `198.51.100.1, ${OUTER}`))).statusCode).toBe(200);
  });

  it("with one trusted proxy the outer proxy's entry is not trusted: clients behind it are told apart by it", async () => {
    const server = await serve({ trustedProxyHops: 1 });
    // One hop trusted: the client key is the rightmost entry; rotating earlier entries never escapes.
    const forged = Array.from({ length: 61 }, (_, i) => meta(PROXY, `192.0.2.${i}, ${CLIENT}`));
    expect((await statuses(server, forged)).at(-1)).toBe(429);
  });
});

describe("NFR-14 FR 8: malformed and forged X-Forwarded-For", () => {
  it.each([
    ["empty", ""],
    ["only commas and spaces", " , , "],
    ["garbage", "not-an-address"],
    ["an address with a port", `${CLIENT}:4444`],
    ["IPv6 in brackets", "[2001:db8::1]"],
    ["many entries", Array.from({ length: 500 }, (_, i) => `10.1.${i >> 8}.${i & 255}`).join(",")],
  ])("without a trusted proxy, %s is ignored: the socket address is the client", async (_where, xff) => {
    const server = await serve();
    const sent = [...Array.from({ length: 60 }, () => meta(CLIENT)), meta(CLIENT, xff)];
    expect((await statuses(server, sent)).at(-1)).toBe(429);
  });

  it("behind one trusted proxy the client's own additions on the left never change its key", async () => {
    const server = await serve({ trustedProxyHops: 1 });
    const lefts = ["", " , ", "garbage, ", `${CLIENT}:1, `, "::ffff:1.2.3.4, ", "2001:db8::1, "];
    const sent = Array.from({ length: 61 }, (_, i) => meta(PROXY, `${lefts[i % lefts.length]}${CLIENT}`));
    expect((await statuses(server, sent)).at(-1)).toBe(429);
  });
});

describe("NFR-14 FR 8: one client, whatever textual form its address takes", () => {
  it.each([
    ["::ffff:cb00:714d", "203.0.113.77"],
    ["0:0:0:0:0:ffff:203.0.113.77", "203.0.113.77"],
    ["::FFFF:203.0.113.77", "203.0.113.77"],
    ["2001:0db8:00aa:00bb::1", "2001:db8:aa:bb::/64"],
    ["2001:db8:aa:bb:1:2:3.4.5.6", "2001:db8:aa:bb::/64"],
    ["2001:db8:aa:bb::1%25eth0", "2001:db8:aa:bb::/64"],
    ["::ffff:203.0.113.77%eth0", "203.0.113.77"],
    [" 203.0.113.77", "unknown"],
    // Adapted after review (coordinator decision): a proxy that writes `ip:port` is counted by the address.
    ["203.0.113.77:4444", "203.0.113.77"],
    ["[2001:db8:aa:bb::1]:4444", "2001:db8:aa:bb::/64"],
    ["1::2::3", "unknown"],
  ])("%s → %s", (address, key) => {
    expect(clientAddressKey(address)).toBe(key);
  });

  it("a dual-stack socket's mapped address and the plain IPv4 share one counter", async () => {
    const server = await serve();
    const sent = Array.from({ length: 61 }, (_, i) => meta(i % 2 ? `::ffff:${CLIENT}` : CLIENT));
    expect((await statuses(server, sent)).at(-1)).toBe(429);
  });

  it("one /64 written in different forms through a proxy is one counter", async () => {
    const server = await serve({ trustedProxyHops: 1 });
    const forms = [
      "2001:db8:aa:bb::1",
      "2001:DB8:AA:BB:0:0:0:2",
      "2001:0db8:00aa:00bb::3",
      "2001:db8:aa:bb:ffff:1:2:3",
    ];
    const sent = Array.from({ length: 61 }, (_, i) => meta(PROXY, forms[i % forms.length]));
    expect((await statuses(server, sent)).at(-1)).toBe(429);
    expect((await server.inject(meta(PROXY, "2001:db8:aa:bc::1"))).statusCode).toBe(200);
  });
});

describe("NFR-14 FR 5: each class has its own counter; a route is never looser than its class", () => {
  it("600 requests to protected routes do not use up the public 60 (and vice versa)", async () => {
    const server = await serve();
    const protectedReq: InjectOptions = {
      method: "GET",
      url: "/v1/things/a",
      remoteAddress: CLIENT,
      headers: principalHeader(),
    };
    expect(
      new Set(
        await statuses(
          server,
          Array.from({ length: 70 }, () => protectedReq),
        ),
      ),
    ).toEqual(new Set([200]));
    expect((await server.inject(meta(CLIENT))).statusCode).toBe(200);
    expect(
      new Set(
        await statuses(
          server,
          Array.from({ length: 59 }, () => meta(CLIENT)),
        ),
      ),
    ).toEqual(new Set([200]));
    expect((await server.inject(meta(CLIENT))).statusCode).toBe(429);
    expect((await server.inject(protectedReq)).statusCode).toBe(200);
  });

  it("a public upload route is limited at 30, not at the public 60", async () => {
    const server = await serve();
    const upload: InjectOptions = { method: "POST", url: "/v1/public-uploads", remoteAddress: CLIENT };
    const result = await statuses(
      server,
      Array.from({ length: 31 }, () => upload),
    );
    expect(result.slice(0, 30)).toEqual(Array(30).fill(201));
    expect(result[30]).toBe(429);
  });
});

describe("NFR-14 FR 6: Retry-After at the window edge; a refusal says nothing of the client", () => {
  it("Retry-After rounds up to whole seconds: 44.5 s left → 45; 1 ms left → 1; a new window counts from 0", async () => {
    let now = 6_000_000 * RATE_LIMIT_WINDOW_MS + 15_500;
    const limiter = createFixedWindowLimiter({
      limit: 1,
      windowMs: RATE_LIMIT_WINDOW_MS,
      store: memoryRateLimitStore(),
      now: () => now,
    });
    await limiter.hit("k");
    expect(await limiter.hit("k")).toMatchObject({ allowed: false, retryAfterS: 45 });
    now = 6_000_000 * RATE_LIMIT_WINDOW_MS + RATE_LIMIT_WINDOW_MS - 1;
    expect(await limiter.hit("k")).toMatchObject({ allowed: false, retryAfterS: 1 });
    now += 1;
    expect(await limiter.hit("k")).toMatchObject({ allowed: true, count: 1 });
  });

  it("the 429 body and headers carry no client address, also when it came through a proxy", async () => {
    const server = await serve({ trustedProxyHops: 1 });
    let last = await server.inject(meta(PROXY, CLIENT));
    for (let i = 0; i < 60; i++) last = await server.inject(meta(PROXY, CLIENT));
    expect(last.statusCode).toBe(429);
    expect(Number(last.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    const everything = JSON.stringify(last.headers) + last.body;
    expect(everything).not.toContain(CLIENT);
    expect(everything).not.toContain(PROXY);
    expect(last.json()).toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });
});

describe("NFR-14: memory stays bounded across windows (expired keys are swept)", () => {
  it("12 000 addresses in each of two windows: the first window's keys are gone in the second", async () => {
    const store = memoryRateLimitStore();
    for (let i = 0; i < 12_000; i++) await store.hit(`a${i}`, 0, 60_000);
    for (let i = 0; i < 12_000; i++) await store.hit(`b${i}`, 60_000, 60_000);
    // The sweep runs every 10 000 hits: by the end only the current window's keys remain.
    expect(store.size()).toBeLessThanOrEqual(12_000);
  });
});
