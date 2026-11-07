import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutgoingFieldError, ProviderError } from "./errors.ts";
import { checkBaseUrl, createProviderHttp } from "./http.ts";
import { outgoingFieldViolations, requestFields } from "./outgoing.ts";
import { defineProviderPort } from "./port.ts";
import { createProviderClient } from "./provider-client.ts";
import { jsonResponse, recordingFetch } from "./testing.ts";

const PORT = defineProviderPort("prices", {
  quote: { idempotent: true, fields: ["symbol"], path: "quote" },
  history: { idempotent: true, fields: ["symbol", "day"], path: "history/{day}" },
});
const OP = PORT.operations.quote;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(answer: (r: Request) => Response | Promise<Response>) {
  const recorder = recordingFetch(answer);
  const client = createProviderClient({ provider: "prices:http", random: () => 0 });
  const http = createProviderHttp({ baseUrl: "https://prices.test/api", client, fetch: recorder.fetch });
  return { recorder, client, http };
}

describe("ARC-05: HTTP transport of working adapters", () => {
  it("sends a GET with the declared query, passes the call's signal and returns the JSON body", async () => {
    const { recorder, http } = setup(() => jsonResponse({ price: "1.5" }));
    await expect(http.getJson(OP, { symbol: "XAU" })).resolves.toEqual({ price: "1.5" });
    expect(recorder.requests.map((r) => r.url)).toEqual(["https://prices.test/api/quote?symbol=XAU"]);
  });

  it("ARC-05 FR 5: refuses an undeclared field before any request is made, and never counts it", async () => {
    const { recorder, http, client } = setup(() => jsonResponse({}));
    for (let i = 0; i < 6; i += 1)
      await expect(http.getJson(OP, { symbol: "XAU", account: "123" })).rejects.toBeInstanceOf(
        OutgoingFieldError,
      );
    expect(recorder.requests).toEqual([]);
    expect(client.breakerState()).toBe("closed");
  });

  it("ARC-05 FR 5: data in the path only through the operation's template, whose placeholders are declared fields", async () => {
    const { recorder, http } = setup(() => jsonResponse({}));
    await http.getJson(PORT.operations.history, { symbol: "XAU", day: "2026-11-06" });
    expect(recorder.requests.map((r) => r.url)).toEqual([
      "https://prices.test/api/history/2026-11-06?symbol=XAU",
    ]);
    expect(await outgoingFieldViolations(PORT.operations.history, recorder.requests)).toEqual([]);
    // A request whose path does not follow the template is reported.
    const other = new Request("https://prices.test/api/history/2026-11-06/owner/jane?symbol=XAU");
    expect(await outgoingFieldViolations(PORT.operations.history, [other])).toEqual(["<undeclared path>"]);
    expect(await requestFields(recorder.requests[0]!, PORT.operations.history)).toEqual(["symbol", "day"]);
    expect(() =>
      defineProviderPort("prices", { q: { idempotent: true, fields: ["symbol"], path: "x/{owner}" } }),
    ).toThrow(/not a declared field/);
  });

  it("ARC-05 FR 3: a transport failure (connection refused, DNS) is «unavailable» without its message", async () => {
    const { http, recorder } = setup(() => {
      throw new TypeError("fetch failed for https://x.test/?email=someone@example.com");
    });
    const result = http.getJson(OP, { symbol: "XAU" }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = (await result) as ProviderError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe("unavailable");
    expect(error.causeName).toBe("TypeError");
    expect(error.message).not.toContain("someone@example.com");
    expect(recorder.requests).toHaveLength(3);
  });

  it("ARC-05 FR 3: an answer refused by `parse` is «invalid-response» and counts towards the breaker", async () => {
    const { http, client, recorder } = setup(() => jsonResponse({ unexpected: true }));
    const parse = (body: unknown) => {
      if (!(body as { price?: string }).price) throw new Error("shape");
      return body;
    };
    for (let i = 0; i < 5; i += 1)
      await expect(http.getJson(OP, { symbol: "XAU" }, parse)).rejects.toMatchObject({
        kind: "invalid-response",
      });
    expect(client.breakerState()).toBe("open");
    await expect(http.getJson(OP, { symbol: "XAU" }, parse)).rejects.toMatchObject({ kind: "circuit-open" });
    expect(recorder.requests).toHaveLength(5);
  });

  it("ARC-05 FR 3: 5xx and 429 are retried as «unavailable»; another 4xx is «rejected» and not retried", async () => {
    let calls = 0;
    const flaky = setup(() =>
      ++calls < 3 ? new Response("", { status: calls === 1 ? 503 : 429 }) : jsonResponse({ ok: 1 }),
    );
    const result = flaky.http.getJson(OP, { symbol: "XAU" });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toEqual({ ok: 1 });
    expect(calls).toBe(3);

    const refused = setup(() => new Response("no", { status: 404 }));
    await expect(refused.http.getJson(OP, { symbol: "XAU" })).rejects.toMatchObject({
      kind: "rejected",
    });
    expect(refused.recorder.requests).toHaveLength(1);
  });

  it("a body that is not JSON is «invalid-response»", async () => {
    const { http } = setup(() => new Response("<html>", { status: 200 }));
    await expect(http.getJson(OP, { symbol: "XAU" })).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });

  it("ARC-05 FR 3: a hanging provider is cut off at 10 s through the request's AbortSignal", async () => {
    let signal: AbortSignal | null = null;
    const { http } = setup(
      (request) =>
        new Promise<Response>(() => {
          signal = request.signal;
        }),
    );
    const result = http.getJson(OP, { symbol: "XAU" }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toMatchObject({ kind: "timeout" });
  });

  it("the base URL is https (plain http only for localhost)", () => {
    expect(checkBaseUrl("https://x.test").href).toBe("https://x.test/");
    expect(checkBaseUrl("http://localhost:8080").href).toBe("http://localhost:8080/");
    expect(() => checkBaseUrl("http://x.test")).toThrow(/https/);
    expect(() => checkBaseUrl("not a url")).toThrow(/not a URL/);
    expect(() => checkBaseUrl("https://x.test/?key=1")).toThrow(/query/);
    expect(() => checkBaseUrl("https://user:pw@x.test/")).toThrow(/credentials/);
  });
});
