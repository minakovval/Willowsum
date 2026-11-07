import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutgoingFieldError, ProviderError } from "./errors.ts";
import { checkBaseUrl, createProviderHttp } from "./http.ts";
import { assertOutgoing, outgoingFieldViolations, undeclaredFields } from "./outgoing.ts";
import { defineProviderPort } from "./port.ts";
import { createProviderClient } from "./provider-client.ts";
import { httpExchangeRates } from "./reference/exchange-rates/index.ts";
import { jsonResponse, recordingFetch } from "./testing.ts";

// Security review of ARC-05 (PR #84): properties of the adapter kit that the PR's own tests leave open.

const PORT = defineProviderPort("prices", {
  quote: { idempotent: true, fields: ["symbol"], path: "quote" },
  rates: { idempotent: true, fields: ["base"] },
  history: { idempotent: true, fields: ["symbol", "day"], path: "history/{day}" },
});
const OP = PORT.operations.quote;
const SECRET = "UA213223130000026007233566001";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(answer: (r: Request) => Response | Promise<Response>, headers?: Record<string, string>) {
  const recorder = recordingFetch(answer);
  const client = createProviderClient({
    provider: "prices:http",
    random: () => 0,
    policy: { retry: { maxAttempts: 1 } },
  });
  const http = createProviderHttp({
    baseUrl: "https://prices.test/api",
    client,
    fetch: recorder.fetch,
    ...(headers ? { headers } : {}),
  });
  return { recorder, client, http };
}

describe("security ARC-05: transport", () => {
  it("plain http is allowed only for exact loopback hosts, never for look-alikes", () => {
    for (const ok of [
      "https://prices.test",
      "http://localhost:8080/x",
      "http://127.0.0.1:9",
      "http://[::1]:9",
    ])
      expect(() => checkBaseUrl(ok)).not.toThrow();
    for (const bad of [
      "http://prices.test",
      "http://localhost.evil.example",
      "http://localhost-evil.example",
      "http://127.0.0.1.nip.io",
      "http://127.evil.example",
      "http://localhost@evil.example",
      "ftp://localhost/x",
      "ws://localhost/x",
      "file:///etc/passwd",
    ])
      expect(() => checkBaseUrl(bad), bad).toThrow(/https/);
  });

  // BLOCKING (http.ts:51), fixed: the path is the operation's declared template (no per-call path), and a
  // placeholder value cannot leave the configured base URL.
  it("a call's path cannot leave the configured base URL or smuggle query parameters", async () => {
    for (const path of [
      "https://evil.example/steal",
      "http://evil.example/steal",
      "//evil.example/steal",
      "../admin",
      "quote/../../admin",
      `quote?account=${SECRET}`,
      "quote#x",
      "quote/{account}",
    ])
      expect(
        () => defineProviderPort("prices", { q: { idempotent: true, fields: ["symbol"], path } }),
        path,
      ).toThrow();
    const history = PORT.operations.history;
    for (const day of ["..", ".", ""]) {
      const { recorder, http } = setup(() => jsonResponse({}));
      await expect(http.getJson(history, { symbol: "XAU", day }), day).rejects.toThrow();
      expect(recorder.requests, day).toEqual([]);
    }
    const { recorder, http } = setup(() => jsonResponse({}));
    await http.getJson(history, { symbol: "XAU", day: "../../evil?x=1#y" });
    expect(recorder.requests.map((r) => r.url)).toEqual([
      "https://prices.test/api/history/..%2F..%2Fevil%3Fx%3D1%23y?symbol=XAU",
    ]);
    expect(await outgoingFieldViolations(history, recorder.requests)).toEqual([]);
  });

  // BLOCKING (http.ts:56-60), fixed: the Request used the default redirect mode «follow».
  it("redirects are never followed: the request asks for manual redirects and a 3xx is refused", async () => {
    const { recorder, http } = setup(
      () => new Response(null, { status: 302, headers: { location: "http://evil.example/x" } }),
    );
    await expect(http.getJson(OP, { symbol: "XAU" })).rejects.toMatchObject({ kind: "rejected" });
    expect(recorder.requests).toHaveLength(1);
    expect(recorder.requests[0]!.redirect).not.toBe("follow");
  });
});

describe("security ARC-05 FR 5: data minimisation on every outgoing path", () => {
  it("the request carries only the accept header and the configured ones; no value goes into a header", async () => {
    const { recorder, http } = setup(() => jsonResponse({}), { "x-api-key": "test-key" });
    await http.getJson(OP, { symbol: SECRET });
    const request = recorder.requests[0]!;
    expect([...request.headers.keys()].sort()).toEqual(["accept", "x-api-key"]);
    for (const [, value] of request.headers) expect(value).not.toContain(SECRET);
    expect(request.method).toBe("GET");
    expect(await request.text()).toBe("");
  });

  it("a provider's answer never reaches the error (message, causeName or serialised form)", async () => {
    for (const status of [400, 404, 429, 500, 503]) {
      const { http } = setup(() => new Response(`account ${SECRET} is blocked`, { status }));
      const error = (await http.getJson(OP, { symbol: "XAU" }).catch((e: unknown) => e)) as ProviderError;
      expect(error).toBeInstanceOf(ProviderError);
      expect(error.causeName).toBe(`HTTP ${status}`);
      const shown = `${error.message} ${String(error.causeName)} ${JSON.stringify(error)} ${String(error.stack)}`;
      expect(shown).not.toContain(SECRET);
    }
  });

  it("the field error names the undeclared fields and never their values", () => {
    const error = (() => {
      try {
        assertOutgoing("prices:http", OP, { symbol: "XAU", account: SECRET, owner: { name: "Olena" } });
      } catch (e) {
        return e as OutgoingFieldError;
      }
      throw new Error("not refused");
    })();
    expect(error).toBeInstanceOf(OutgoingFieldError);
    expect(error.fields).toEqual(["account", "owner.name"]);
    expect(error.message).toContain("account");
    expect(error.message).toContain("owner.name");
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain("Olena");
  });

  it("a declared field covers only itself and what is below it, never a look-alike name", async () => {
    const op = PORT.operations.rates;
    expect(undeclaredFields(op, { base: "EUR", baseline: SECRET, base_extra: "x", "base-x": "y" })).toEqual([
      "base-x",
      "base_extra",
      "baseline",
    ]);
    expect(undeclaredFields(op, { base: { code: "EUR" } })).toEqual([]);
    const request = new Request(`https://p.test/r?base=EUR&baseline=${SECRET}`);
    expect(await outgoingFieldViolations(op, [request])).toEqual(["baseline"]);
  });
});

describe("security ARC-05 FR 3: a refused outgoing field is not a provider failure", () => {
  const field = () => new OutgoingFieldError("prices:http", OP.name, ["account"]);

  it("is passed on as is, never retried and never counted by the breaker", async () => {
    const client = createProviderClient({ provider: "p", random: () => 0 });
    const run = vi.fn(() => Promise.reject(field()));
    for (let i = 0; i < 6; i += 1)
      await expect(client.call(OP, run)).rejects.toBeInstanceOf(OutgoingFieldError);
    expect(run).toHaveBeenCalledTimes(6);
    expect(client.breakerState()).toBe("closed");
  });

  it("frees a half-open probe, so the next call may probe the provider", async () => {
    const client = createProviderClient({
      provider: "p",
      random: () => 0,
      policy: { retry: { maxAttempts: 1 } },
    });
    const down = () => Promise.reject(new ProviderError("unavailable", "p", OP.name));
    for (let i = 0; i < 5; i += 1)
      await expect(client.call(OP, down)).rejects.toMatchObject({ kind: "unavailable" });
    expect(client.breakerState()).toBe("open");
    vi.advanceTimersByTime(60_000);
    expect(client.breakerState()).toBe("half-open");
    await expect(client.call(OP, () => Promise.reject(field()))).rejects.toBeInstanceOf(OutgoingFieldError);
    const probe = vi.fn(async () => "ok");
    await expect(client.call(OP, probe)).resolves.toBe("ok");
    expect(probe).toHaveBeenCalledTimes(1);
    expect(client.breakerState()).toBe("closed");
  });
});

describe("security ARC-05: parsing provider rates", () => {
  // N5: a requested date after today is refused, so these cases run on a clock after the dates they ask for.
  beforeEach(() => {
    vi.setSystemTime(new Date("2027-01-02T00:00:00.000Z"));
  });
  const REQUEST = { base: "EUR", quotes: ["USD"], date: "2026-11-30" };
  function source(body: unknown) {
    return httpExchangeRates({
      baseUrl: "https://rates.test/v1",
      source: "reference-provider",
      fetch: recordingFetch(() => jsonResponse(body)).fetch,
      random: () => 0,
      policy: { retry: { maxAttempts: 1 } },
    });
  }

  it("refuses every rate that is not a plain positive decimal string", async () => {
    for (const rate of [
      "1e3",
      "1E-2",
      "-1.5",
      "+1.5",
      "1,5",
      " 1.1",
      "1.1 ",
      "1.1\n",
      "Infinity",
      "NaN",
      "0x10",
      "1.",
      ".5",
      "01.5",
      "١٫٥",
      "0.000",
      "",
      1.5,
      15,
      null,
      true,
      ["1.5"],
      { value: "1.5" },
    ]) {
      await expect(
        source({ base: "EUR", date: "2026-11-30", rates: { USD: rate } }).ratesOn(REQUEST),
        String(rate),
      ).rejects.toMatchObject({ kind: "invalid-response" });
    }
  });

  it("refuses a rate dated after the requested day (across month and year ends) or with a malformed date", async () => {
    for (const [asked, given] of [
      ["2026-11-30", "2026-12-01"],
      ["2026-12-31", "2027-01-01"],
      ["2026-11-30", "2026-11-31"],
      ["2026-11-30", "2026-11-3"],
      ["2026-11-30", "20261129"],
      ["2026-11-30", "2026-11-29T23:00:00Z"],
    ] as const) {
      await expect(
        source({ base: "EUR", date: given, rates: { USD: "1.1" } }).ratesOn({ ...REQUEST, date: asked }),
        `${asked} ← ${given}`,
      ).rejects.toMatchObject({ kind: "invalid-response" });
    }
    const same = await source({ base: "EUR", date: "2026-11-30", rates: { USD: "1.1" } }).ratesOn(REQUEST);
    expect(same[0]!.date).toBe("2026-11-30");
  });
});
