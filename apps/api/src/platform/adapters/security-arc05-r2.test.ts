import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { systemClock } from "./clock.ts";
import { OutgoingFieldError, ProviderError } from "./errors.ts";
import { checkBaseUrl, createProviderHttp, requestUrl } from "./http.ts";
import { UNDECLARED_PATH, outgoingFieldViolations } from "./outgoing.ts";
import { defineProviderPort, type ProviderOperation } from "./port.ts";
import { createProviderClient } from "./provider-client.ts";
import { httpExchangeRates } from "./reference/exchange-rates/index.ts";
import { jsonResponse, recordingFetch } from "./testing.ts";

// Security review of ARC-05 (PR #84), round 2: the path templates, redirects, the breaker's handling of
// non-provider errors and the future-date refusal.

const SECRET = "UA213223130000026007233566001";
const PORT = defineProviderPort("prices", {
  quote: { idempotent: true, fields: ["symbol"], path: "quote" },
  rates: { idempotent: true, fields: ["base"], path: "rates" },
});
const BASE = new URL("https://prices.test/api/");

/** An operation built by hand (the type allows it), bypassing defineProviderPort's template checks. */
const handBuilt = (path: string): ProviderOperation => ({
  name: "prices.raw",
  idempotent: true,
  fields: ["symbol"],
  path,
});

function setup(answer: (r: Request) => Response | Promise<Response>) {
  const recorder = recordingFetch(answer);
  const client = createProviderClient({
    provider: "prices:http",
    random: () => 0,
    policy: { retry: { maxAttempts: 1 } },
  });
  const provider = createProviderHttp({ baseUrl: "https://prices.test/api", client, fetch: recorder.fetch });
  return { recorder, client, http: provider };
}

describe("security ARC-05 r2: the base URL and path templates", () => {
  it("a base URL never carries credentials (user or password alone), a query or a fragment", () => {
    for (const bad of [
      "https://user@prices.test/api",
      "https://:secret@prices.test/api",
      "https://user:secret@prices.test/api",
      "https://prices.test/api?key=1",
      "https://prices.test/api#frag",
    ])
      expect(() => checkBaseUrl(bad), bad).toThrow();
  });

  it("a placeholder appears once and names a declared field; fixed segments are plain", () => {
    for (const path of [
      "h/{day}/{day}",
      "h/{other}",
      "h//x",
      "/h",
      "h/",
      "h/.",
      "h/..",
      "h/.x",
      "h/{day}x",
      "h/{ day}",
    ])
      expect(
        () => defineProviderPort("prices", { h: { idempotent: true, fields: ["day"], path } }),
        path,
      ).toThrow();
    expect(() =>
      defineProviderPort("prices", { h: { idempotent: true, fields: ["day"], path: "h/{day}/x" } }),
    ).not.toThrow();
  });

  it("even an operation built by hand cannot leave the base URL (origin and base path checked)", () => {
    for (const path of [
      "../admin",
      "x/../../admin",
      "https://evil.example/x",
      "//evil.example/x",
      "http://prices.test/api/x",
      "/x",
    ])
      expect(() => requestUrl(BASE, handBuilt(path), {}), path).toThrow();
    const noBasePath = new URL("https://prices.test/");
    expect(() => requestUrl(noBasePath, handBuilt("//evil.example/x"), {})).toThrow();
    expect(requestUrl(BASE, handBuilt("quote"), { symbol: "XAU" }).href).toBe(
      "https://prices.test/api/quote?symbol=XAU",
    );
  });

  // Non-blocking, fixed: getJson trusted operation.path. A hand-built operation (or one mutated after
  // defineProviderPort, if it were not frozen) can carry data in its path; only outgoingFieldViolations in the
  // adapter's own test would notice. Fix: getJson re-runs pathTemplateProblems (or brands defined ops).
  it("getJson refuses an operation whose path is not a valid template", async () => {
    const { recorder, http: provider } = setup(() => jsonResponse({}));
    await expect(provider.getJson(handBuilt(`quote?account=${SECRET}`), { symbol: "XAU" })).rejects.toThrow();
    expect(recorder.requests).toEqual([]);
  });

  it("the test helper checks the whole path segment by segment, not a suffix or a prefix", async () => {
    const op = PORT.operations.rates;
    const at = (url: string) => outgoingFieldViolations(op, [new Request(url)]);
    expect(await at("https://p.test/api/rates?base=EUR")).toEqual([]);
    expect(await at("https://p.test/api/xrates?base=EUR")).toEqual([UNDECLARED_PATH]);
    expect(await at(`https://p.test/api/rates/${SECRET}?base=EUR`)).toEqual([UNDECLARED_PATH]);
  });
});

describe("security ARC-05 r2: redirects with the real global fetch", () => {
  let target: http.Server;
  let origin: http.Server;
  let targetHits = 0;
  beforeEach(async () => {
    targetHits = 0;
    target = http.createServer((_, res) => {
      targetHits += 1;
      res.setHeader("content-type", "application/json");
      res.end("{}");
    });
    target.listen(0, "127.0.0.1");
    await once(target, "listening");
    const to = `http://127.0.0.1:${(target.address() as AddressInfo).port}/stolen`;
    origin = http.createServer((_, res) => {
      res.statusCode = 302;
      res.setHeader("location", to);
      res.end();
    });
    origin.listen(0, "127.0.0.1");
    await once(origin, "listening");
  });
  afterEach(() => {
    target.close();
    origin.close();
  });

  it("a 302 to another host is refused as «rejected» and the other host is never contacted", async () => {
    const client = createProviderClient({ provider: "prices:http", random: () => 0 });
    const provider = createProviderHttp({
      baseUrl: `http://127.0.0.1:${(origin.address() as AddressInfo).port}/api`,
      client,
    });
    await expect(provider.getJson(PORT.operations.quote, { symbol: "XAU" })).rejects.toMatchObject({
      kind: "rejected",
    });
    expect(targetHits).toBe(0);
    expect(client.breakerState()).toBe("closed");
  });

  it("an opaque or error response (status 0) is refused, not parsed", async () => {
    const { http: provider } = setup(() => Response.error());
    await expect(provider.getJson(PORT.operations.quote, { symbol: "XAU" })).rejects.toMatchObject({
      kind: "rejected",
    });
  });
});

describe("security ARC-05 r2: an adapter bug is not a provider answer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const bug = () => Promise.reject(new TypeError("cannot read x of undefined"));
  const down = () => Promise.reject(new ProviderError("unavailable", "p", "prices.quote"));
  const OP = PORT.operations.quote;

  it("is passed on unchanged, not retried, and does not end a run of failures", async () => {
    const client = createProviderClient({
      provider: "p",
      random: () => 0,
      policy: { retry: { maxAttempts: 1 } },
    });
    for (let i = 0; i < 4; i += 1) await expect(client.call(OP, down)).rejects.toBeInstanceOf(ProviderError);
    const run = vi.fn(bug);
    await expect(client.call(OP, run)).rejects.toBeInstanceOf(TypeError);
    expect(run).toHaveBeenCalledTimes(1);
    await expect(client.call(OP, down)).rejects.toBeInstanceOf(ProviderError);
    expect(client.breakerState()).toBe("open");
  });

  it("does not close an open breaker: a half-open probe ending in a bug leaves it half-open", async () => {
    const client = createProviderClient({
      provider: "p",
      random: () => 0,
      policy: { retry: { maxAttempts: 1 } },
    });
    for (let i = 0; i < 5; i += 1) await expect(client.call(OP, down)).rejects.toBeInstanceOf(ProviderError);
    vi.advanceTimersByTime(60_000);
    await expect(client.call(OP, bug)).rejects.toBeInstanceOf(TypeError);
    expect(client.breakerState()).toBe("half-open");
    const field = () => Promise.reject(new OutgoingFieldError("p", OP.name, ["x"]));
    await expect(client.call(OP, field)).rejects.toBeInstanceOf(OutgoingFieldError);
    expect(client.breakerState()).toBe("half-open");
  });
});

describe("security ARC-05 r2: no rates for a future date", () => {
  it("the working implementation judges «future» by its injected clock, not the system clock", async () => {
    const recorder = recordingFetch(() =>
      jsonResponse({ base: "EUR", date: "2026-06-01", rates: { USD: "1.1" } }),
    );
    const clock = { ...systemClock, now: () => Date.parse("2026-01-01T12:00:00Z") };
    const source = httpExchangeRates({
      baseUrl: "https://rates.test/v1",
      source: "x",
      fetch: recorder.fetch,
      clock,
      random: () => 0,
    });
    await expect(source.ratesOn({ base: "EUR", quotes: ["USD"], date: "2026-06-01" })).rejects.toThrow(
      /future/,
    );
    await expect(source.ratesOn({ base: "EUR", quotes: ["USD"], date: "2026-01-02" })).rejects.toThrow(
      /future/,
    );
    expect(recorder.requests).toEqual([]);
    const today = recordingFetch(() =>
      jsonResponse({ base: "EUR", date: "2026-01-01", rates: { USD: "1.1" } }),
    );
    const ok = httpExchangeRates({
      baseUrl: "https://rates.test/v1",
      source: "x",
      fetch: today.fetch,
      clock,
      random: () => 0,
    });
    await expect(ok.ratesOn({ base: "EUR", quotes: ["USD"], date: "2026-01-01" })).resolves.toHaveLength(1);
  });
});
