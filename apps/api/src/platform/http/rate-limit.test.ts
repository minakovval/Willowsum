import { describe, expect, it } from "vitest";
import {
  clientAddressKey,
  createFixedWindowLimiter,
  memoryRateLimitStore,
  RATE_LIMITS,
  RATE_LIMIT_WINDOW_MS,
} from "./rate-limit.ts";

describe("NFR-14 FR 5: the limits of the requirement", () => {
  it("public 60, uploads 30, the rest 600, per one-minute window", () => {
    expect(RATE_LIMITS).toEqual({ public: 60, upload: 30, default: 600 });
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });
});

describe("NFR-14 FR 5–7: the reusable fixed-window limiter (also for ACC-01's own limits)", () => {
  it("allows `limit` hits per key per window, refuses the next, and resets in the next window", async () => {
    let now = 15 * 60_000 + 1_000;
    const limiter = createFixedWindowLimiter({
      limit: 5,
      windowMs: 15 * 60_000,
      store: memoryRateLimitStore(),
      now: () => now,
    });
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await limiter.hit("account:a"));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, true, true, false]);
    expect(results[5]).toMatchObject({ count: 6, limit: 5, retryAfterS: 899 });
    expect((await limiter.hit("account:b")).allowed).toBe(true);
    now += 15 * 60_000;
    expect((await limiter.hit("account:a")).allowed).toBe(true);
  });

  it("Retry-After is whole seconds, at least 1", async () => {
    const limiter = createFixedWindowLimiter({
      limit: 1,
      windowMs: 60_000,
      store: memoryRateLimitStore(),
      now: () => 119_999,
    });
    await limiter.hit("k");
    expect((await limiter.hit("k")).retryAfterS).toBe(1);
  });

  it("refuses a nonsensical configuration", () => {
    const store = memoryRateLimitStore();
    expect(() => createFixedWindowLimiter({ limit: 0, windowMs: 60_000, store })).toThrow();
    expect(() => createFixedWindowLimiter({ limit: 1, windowMs: 10, store })).toThrow();
  });
});

describe("NFR-14: the in-memory store stays bounded under a flood from many addresses", () => {
  it("expired windows are swept; beyond maxKeys new keys share one overflow counter of their class", async () => {
    const overflowed: [string, boolean][] = [];
    const store = memoryRateLimitStore({ maxKeys: 3, onOverflow: (p, first) => overflowed.push([p, first]) });
    expect(await store.hit("default:a", 0, 60_000)).toBe(1);
    await store.hit("default:b", 0, 60_000);
    await store.hit("public:c", 0, 60_000);
    // Full: new keys count together, per class — overflowed default traffic leaves the public budget alone.
    expect(await store.hit("default:d", 0, 60_000)).toBe(1);
    expect(await store.hit("default:e", 0, 60_000)).toBe(2);
    expect(await store.hit("public:f", 0, 60_000)).toBe(1);
    expect(overflowed).toEqual([
      ["default", true],
      ["default", false],
      ["public", true],
    ]);
    // Next window: the old ones are swept when room is needed.
    expect(await store.hit("default:g", 60_000, 60_000)).toBe(1);
    expect(store.size()).toBe(1);
    expect(store.shared).toBe(false);
  });

  it("under a flood of new keys a full sweep runs at most once per window, not on every new key", async () => {
    const store = memoryRateLimitStore({ maxKeys: 100 });
    for (let i = 0; i < 100; i++) await store.hit(`public:${i}`, 0, 60_000);
    const before = store.sweeps();
    for (let i = 100; i < 5_000; i++) await store.hit(`public:${i}`, 0, 60_000);
    expect(store.sweeps() - before).toBe(1);
    // The next window may sweep once more.
    for (let i = 0; i < 1_000; i++) await store.hit(`public:n${i}`, 60_000, 60_000);
    expect(store.sweeps() - before).toBeLessThanOrEqual(2);
  });
});

describe("NFR-14 FR 8: the counter key of a client address", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"],
    ["2001:db8:1:2::9", "2001:db8:1:2::/64"],
    ["2001:DB8:1:2:ffff::1", "2001:db8:1:2::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    // A proxy that writes `ip:port`: the port is dropped.
    ["203.0.113.7:4711", "203.0.113.7"],
    ["[2001:db8:1:2::9]:4711", "2001:db8:1:2::/64"],
    ["[2001:db8:1:2::9]", "2001:db8:1:2::/64"],
    ["::1", "0:0:0:0::/64"],
    [undefined, "unknown"],
    ["not-an-address", "unknown"],
  ])("%s → %s", (address, key) => {
    expect(clientAddressKey(address)).toBe(key);
  });

  it("one IPv6 /64 is one client: rotating the interface part does not escape the limit", () => {
    expect(clientAddressKey("2001:db8:aa:bb::1")).toBe(clientAddressKey("2001:db8:aa:bb:dead:beef:1:2"));
    expect(clientAddressKey("2001:db8:aa:bb::1")).not.toBe(clientAddressKey("2001:db8:aa:bc::1"));
  });
});
