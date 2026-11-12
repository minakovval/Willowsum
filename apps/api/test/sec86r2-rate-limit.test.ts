import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerApi } from "../src/platform/http/api.ts";
import { metaRoute } from "../src/platform/http/meta.ts";
import {
  clientAddressKey,
  createApiRateLimits,
  memoryRateLimitStore,
  MEMORY_STORE_MAX_KEYS,
  RATE_LIMIT_WINDOW_MS,
  reportRateLimitOverflow,
  type RateLimitStore,
} from "../src/platform/http/rate-limit.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { exportedText, testTelemetryForFile } from "../src/platform/telemetry/testing.ts";
import { testApiOptions } from "./http.ts";

/**
 * Security review of PR #86, round 2 (NFR-14 FR 8, memory bound): `ip:port` and `[v6]:port` forms through a
 * trusted proxy; anything malformed is `unknown`, never a key the client can shape; the in-memory store stays
 * bounded and its overflow is reported by class only.
 */
const telemetry = testTelemetryForFile();

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

// Fixed once per run, so a run crossing a minute boundary cannot start a new rate-limit window mid-test.
const FIXEDNOW_AT = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS + 15_000;
const fixedNow = () => FIXEDNOW_AT;

describe("NFR-14 FR 8: ip:port and [v6]:port (round 2)", () => {
  it("well-formed forms give the address (v4) or its /64 (v6); a zone id is dropped", () => {
    expect(clientAddressKey("203.0.113.7:4711")).toBe("203.0.113.7");
    expect(clientAddressKey("203.0.113.7:0")).toBe("203.0.113.7");
    expect(clientAddressKey("[2001:db8::1]:4711")).toBe(clientAddressKey("2001:db8::1"));
    expect(clientAddressKey("[2001:db8::1]")).toBe(clientAddressKey("2001:db8::1"));
    expect(clientAddressKey("[fe80::1%eth0]:443")).toBe(clientAddressKey("fe80::1"));
    expect(clientAddressKey("[::ffff:203.0.113.7]:80")).toBe("203.0.113.7");
  });

  it.each([
    "203.0.113.7:",
    "203.0.113.7:80:90",
    "203.0.113.7:123456",
    "203.0.113.7:-1",
    "203.0.113.7:8o",
    "203.0.113.7 :80",
    " 203.0.113.7:80",
    "x203.0.113.7:80",
    "1203.0.113.7:80",
    "203.0.113.7:80x",
    "0203.0.113.7:80",
    "203.0.113.256:80",
    "[2001:db8::1]:",
    "[2001:db8::1]:80:90",
    "[2001:db8::1]:123456",
    "[[2001:db8::1]]:80",
    "x[2001:db8::1]:80",
    "[2001:db8::1]:80x",
    "[2001:db8::1",
    "2001:db8::1]:80",
    "[]:80",
    "[not-an-ip]:80",
    "[203.0.113.7:80]",
  ])("malformed %j is the shared `unknown` key", (value) => {
    expect(clientAddressKey(value)).toBe("unknown");
  });

  async function keysSeen(hops: number, requests: { remoteAddress: string; xff?: string }[]) {
    const seen: string[] = [];
    const inner = memoryRateLimitStore();
    const store: RateLimitStore = {
      shared: false,
      hit: (key, start, ms) => {
        seen.push(key);
        return inner.hit(key, start, ms);
      },
    };
    app = buildServer({
      readiness: async () => ({ ready: true }),
      trustedProxyHops: hops,
      api: (a) =>
        registerApi(
          a,
          testApiOptions([metaRoute], { rateLimits: createApiRateLimits({ store, now: fixedNow }) }),
        ),
    });
    await app.ready();
    for (const r of requests)
      await app.inject({
        method: "GET",
        url: "/v1/meta",
        remoteAddress: r.remoteAddress,
        headers: r.xff === undefined ? {} : { "x-forwarded-for": r.xff },
      });
    await app.close();
    app = undefined;
    return seen;
  }

  it("hops 0: a forwarded ip:port is ignored — the socket peer is the client", async () => {
    expect(
      await keysSeen(0, [
        { remoteAddress: "10.0.0.5", xff: "203.0.113.7:4711" },
        { remoteAddress: "10.0.0.5", xff: "[2001:db8::1]:4711" },
      ]),
    ).toEqual(["public:10.0.0.5", "public:10.0.0.5"]);
  });

  it("hops 1: only the proxy's own (rightmost) entry counts, with its port dropped; client additions are ignored", async () => {
    expect(
      await keysSeen(1, [
        { remoteAddress: "10.0.0.5", xff: "198.51.100.1:1, 203.0.113.7:4711" },
        { remoteAddress: "10.0.0.5", xff: "[2001:db8::99]:1, 203.0.113.7:4712" },
        { remoteAddress: "10.0.0.5", xff: "198.51.100.1, [2001:db8::1]:4711" },
        { remoteAddress: "10.0.0.5", xff: "198.51.100.1, 203.0.113.7:80:90" },
      ]),
    ).toEqual([
      "public:203.0.113.7",
      "public:203.0.113.7",
      `public:${clientAddressKey("2001:db8::1")}`,
      "public:unknown",
    ]);
  });

  it("hops 2: the second entry from the right; a port the client puts further left never matters", async () => {
    expect(
      await keysSeen(2, [
        { remoteAddress: "10.0.0.5", xff: "198.51.100.9:7, 203.0.113.7:4711, 10.0.0.4" },
        { remoteAddress: "10.0.0.5", xff: "203.0.113.7, 203.0.113.8:4711, 10.0.0.4:9" },
      ]),
    ).toEqual(["public:203.0.113.7", "public:203.0.113.8"]);
  });
});

describe("NFR-14: the in-memory store under a flood of distinct keys (round 2)", () => {
  it("never holds more than maxKeys keys plus one overflow counter per class, over many windows", async () => {
    const store = memoryRateLimitStore({ maxKeys: 100 });
    let peak = 0;
    for (let w = 0; w < 3; w++)
      for (let i = 0; i < 3_000; i++) {
        const cls = ["public", "upload", "default"][i % 3];
        await store.hit(`${cls}:198.51.${w}.${i}`, w * 60_000, 60_000);
        peak = Math.max(peak, store.size());
      }
    expect(peak).toBeLessThanOrEqual(100 + 3);
  });

  it("keys with more colons (IPv6 /64 keys) still share one overflow counter of their class", async () => {
    const store = memoryRateLimitStore({ maxKeys: 10 });
    for (let i = 0; i < 1_000; i++) await store.hit(`public:${i}`, 0, 60_000);
    for (let i = 0; i < 1_000; i++) await store.hit(`public:a:${i}`, 0, 60_000);
    expect(store.size()).toBeLessThanOrEqual(10 + 1);
  });

  it("expired keys are dropped every 10 000 hits even when no new key ever overflows", async () => {
    const store = memoryRateLimitStore({ maxKeys: 1_000_000 });
    for (let i = 0; i < 5_000; i++) await store.hit(`default:${i}`, 0, 60_000);
    for (let i = 0; i < 10_000; i++) await store.hit("default:one", 60_000, 60_000);
    expect(store.size()).toBeLessThanOrEqual(2);
  });

  it("overflowed traffic of one class never uses up another class's overflow counter", async () => {
    const store = memoryRateLimitStore({ maxKeys: 2 });
    await store.hit("default:a", 0, 60_000);
    await store.hit("default:b", 0, 60_000);
    for (let i = 0; i < 50; i++) await store.hit(`default:x${i}`, 0, 60_000);
    expect(await store.hit("public:y", 0, 60_000)).toBe(1);
    expect(await store.hit("upload:z", 0, 60_000)).toBe(1);
  });

  it("onOverflow is told the class and «first in window» once per class per window — never the address", async () => {
    const calls: [string, boolean][] = [];
    const store = memoryRateLimitStore({ maxKeys: 1, onOverflow: (p, f) => calls.push([p, f]) });
    await store.hit("public:203.0.113.1", 0, 60_000);
    await store.hit("public:203.0.113.2", 0, 60_000);
    await store.hit("public:203.0.113.3", 0, 60_000);
    await store.hit("default:203.0.113.4", 0, 60_000);
    await store.hit("public:203.0.113.5", 60_000, 60_000);
    await store.hit("public:203.0.113.6", 60_000, 60_000);
    expect(calls).toEqual([
      ["public", true],
      ["public", false],
      ["default", true],
      // The new window's sweep frees the slot: the first key of window 2 is counted on its own, the next overflows.
      ["public", true],
    ]);
  });

  it("reportRateLimitOverflow drops anything that is not a class: no metric point, no log, no address exported", async () => {
    await telemetry.forceFlush();
    const logsBefore = telemetry.memory.logRecords().length;
    for (const prefix of ["203.0.113.66", "2001:db8::66", "unknown", "overflow", ""])
      reportRateLimitOverflow(prefix, true);
    await telemetry.forceFlush();
    expect(telemetry.memory.logRecords().length).toBe(logsBefore);
    const text = await exportedText(telemetry);
    expect(text).not.toContain("203.0.113.66");
    expect(text).not.toContain("2001:db8::66");
  });

  it("the API's default store reports its overflow (wired by createApiRateLimits), by class only", async () => {
    const limits = createApiRateLimits({ now: fixedNow });
    for (let i = 0; i <= MEMORY_STORE_MAX_KEYS; i++) await limits.limiters.upload.hit(`upload:k${i}`);
    await telemetry.forceFlush();
    const logs = telemetry.memory.logRecords().filter((r) => r.eventName === "rate_limit.overflow");
    expect(logs.map((r) => r.attributes)).toContainEqual({ "ws.rate_limit.class": "upload" });
  });
});
