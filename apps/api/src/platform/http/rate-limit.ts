import { isIPv4, isIPv6 } from "node:net";
import { ApiProblem } from "./problem.ts";

/**
 * Request rate limits (NFR-14 FR 5–10; ADR-0007). The primitive is a fixed-window counter per key
 * (`createFixedWindowLimiter`) over a `RateLimitStore`; the API uses three of them, one per class of route,
 * keyed by the client's address. The identity module (ACC-01) reuses the same primitive for its own limits
 * (failed sign-ins per account, sign-ups per address, provider tokens) with a store that survives restarts.
 */

/** Classes of API routes (declared in defineRoute, NFR-14 FR 5). */
export const RATE_LIMIT_CLASSES = ["public", "upload", "default"] as const;
export type RateLimitClass = (typeof RATE_LIMIT_CLASSES)[number];

/**
 * Requests per client address per minute (NFR-14 FR 5): public endpoints (actions without sign-in, signed
 * file links, webhooks) 60; file uploads 30; the rest of the API 600. Numbers of the requirement, not of a plan.
 */
export const RATE_LIMITS: Readonly<Record<RateLimitClass, number>> = Object.freeze({
  public: 60,
  upload: 30,
  default: 600,
});
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Counters of fixed windows. In one process (memory) or shared by every instance (a later store). */
export interface RateLimitStore {
  /** Adds one hit to `key` in the window that starts at `windowStart` (ms) and returns the count with it. */
  hit(key: string, windowStart: number, windowMs: number): Promise<number>;
  /** True when the counters are shared by every instance of the API (NFR-14 FR 10). */
  readonly shared: boolean;
}

/** Keys in memory before new ones share one overflow counter (a flood from very many addresses). */
export const MEMORY_STORE_MAX_KEYS = 200_000;
const OVERFLOW_KEY = "\u0000overflow";
const SWEEP_EVERY_HITS = 10_000;

/**
 * Counters in this process only: valid while the API runs as one instance (the «Старт» profile, ARC-08);
 * the configuration refuses more instances with this store (config.ts, NFR-14 FR 10). Memory is bounded:
 * expired windows are swept, and beyond `maxKeys` live keys every new key counts in one shared overflow
 * counter, so a flood from many addresses is limited as a whole instead of growing the map.
 */
export function memoryRateLimitStore(options: { maxKeys?: number } = {}): RateLimitStore & {
  size(): number;
} {
  const maxKeys = options.maxKeys ?? MEMORY_STORE_MAX_KEYS;
  const entries = new Map<string, { windowStart: number; expires: number; count: number }>();
  let hits = 0;
  const sweep = (now: number): void => {
    for (const [key, entry] of entries) if (entry.expires <= now) entries.delete(key);
  };
  return {
    shared: false,
    size: () => entries.size,
    hit: async (key, windowStart, windowMs) => {
      hits += 1;
      if (hits % SWEEP_EVERY_HITS === 0) sweep(windowStart);
      let id = key;
      if (!entries.has(id) && entries.size >= maxKeys) {
        sweep(windowStart);
        if (entries.size >= maxKeys) id = `${OVERFLOW_KEY}:${windowMs}`;
      }
      const entry = entries.get(id);
      if (entry && entry.windowStart === windowStart) {
        entry.count += 1;
        return entry.count;
      }
      entries.set(id, { windowStart, expires: windowStart + windowMs, count: 1 });
      return 1;
    },
  };
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Hits in the current window, this one included. */
  readonly count: number;
  readonly limit: number;
  /** Whole seconds until the window ends (≥ 1): the `Retry-After` of a refusal. */
  readonly retryAfterS: number;
}

export interface FixedWindowLimiter {
  readonly limit: number;
  readonly windowMs: number;
  hit(key: string): Promise<RateLimitDecision>;
}

/**
 * At most `limit` hits per key in each fixed window of `windowMs` (windows start at multiples of `windowMs`
 * since the epoch). A refused hit still counts, so a client that keeps sending stays refused until the window ends.
 */
export function createFixedWindowLimiter(options: {
  readonly limit: number;
  readonly windowMs: number;
  readonly store: RateLimitStore;
  readonly now?: () => number;
}): FixedWindowLimiter {
  const { limit, windowMs, store } = options;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("rate limit: limit is a positive integer");
  if (!Number.isInteger(windowMs) || windowMs < 1_000) throw new Error("rate limit: window is ≥ 1 s");
  const now = options.now ?? Date.now;
  return {
    limit,
    windowMs,
    hit: async (key) => {
      const at = now();
      const windowStart = Math.floor(at / windowMs) * windowMs;
      const count = await store.hit(key, windowStart, windowMs);
      return {
        allowed: count <= limit,
        count,
        limit,
        retryAfterS: Math.max(1, Math.ceil((windowStart + windowMs - at) / 1000)),
      };
    },
  };
}

/** The limiters of the API, one per class, over one store. */
export interface ApiRateLimits {
  readonly limiters: Readonly<Record<RateLimitClass, FixedWindowLimiter>>;
  readonly store: RateLimitStore;
}

export function createApiRateLimits(
  options: { store?: RateLimitStore; now?: () => number } = {},
): ApiRateLimits {
  const store = options.store ?? memoryRateLimitStore();
  const limiter = (c: RateLimitClass): FixedWindowLimiter =>
    createFixedWindowLimiter({
      limit: RATE_LIMITS[c],
      windowMs: RATE_LIMIT_WINDOW_MS,
      store,
      ...(options.now ? { now: options.now } : {}),
    });
  return {
    store,
    limiters: Object.freeze({
      public: limiter("public"),
      upload: limiter("upload"),
      default: limiter("default"),
    }),
  };
}

/** 429 RATE_LIMITED with the seconds for `Retry-After` (NFR-14 FR 6). */
export class RateLimited extends ApiProblem {
  readonly retryAfterS: number;
  readonly limitClass: RateLimitClass;

  constructor(limitClass: RateLimitClass, retryAfterS: number) {
    super("RATE_LIMITED");
    this.name = "RateLimited";
    this.limitClass = limitClass;
    this.retryAfterS = retryAfterS;
  }
}

function expandIPv6(address: string): number[] | undefined {
  const [head = "", tail, extra] = address.split("::");
  if (extra !== undefined) return undefined;
  const part = (s: string): string[] => (s === "" ? [] : s.split(":"));
  let left = part(head);
  let right = tail === undefined ? [] : part(tail);
  // An embedded IPv4 tail (::ffff:192.0.2.1) is two groups.
  const last = (tail === undefined ? left : right).at(-1);
  if (last !== undefined && isIPv4(last)) {
    const [a, b, c, d] = last.split(".").map(Number) as [number, number, number, number];
    const groups = [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
    if (tail === undefined) left = [...left.slice(0, -1), ...groups];
    else right = [...right.slice(0, -1), ...groups];
  }
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return undefined;
  return [...left, ...Array<string>(tail === undefined ? 0 : missing).fill("0"), ...right].map((g) =>
    Number.parseInt(g, 16),
  );
}

/**
 * The counter key of a client address: an IPv4 address as is (also when mapped into IPv6), an IPv6 address
 * by its /64 network — one subscriber usually holds a whole /64, so counting single addresses would let one
 * client rotate through 2^64 of them. Anything that is not an address shares one key. Kept in memory only:
 * client addresses are never logged or exported (NFR-17, ADR-0006).
 */
export function clientAddressKey(address: string | undefined): string {
  const raw = (address ?? "").replace(/%.*$/, "");
  if (isIPv4(raw)) return raw;
  if (!isIPv6(raw)) return "unknown";
  const groups = expandIPv6(raw.toLowerCase());
  if (!groups) return "unknown";
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    const [hi = 0, lo = 0] = groups.slice(6);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}
