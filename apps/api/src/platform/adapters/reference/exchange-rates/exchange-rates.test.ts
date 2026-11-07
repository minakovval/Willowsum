import { Decimal, Money, convert } from "@willowsum/domain-kernel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../../config/config.ts";
import { outgoingFieldViolations } from "../../outgoing.ts";
import { jsonResponse, recordingFetch } from "../../testing.ts";
import {
  EXCHANGE_RATES_PORT,
  EXCHANGE_RATE_IMPLEMENTATIONS,
  exchangeRateSource,
  httpExchangeRates,
  syntheticExchangeRates,
  withLastKnownRates,
} from "./index.ts";

const REQUEST = { base: "EUR", quotes: ["USD", "UAH"], date: "2026-11-06" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

function live(answer: (r: Request) => Response | Promise<Response>) {
  const recorder = recordingFetch(answer);
  const source = httpExchangeRates({
    baseUrl: "https://rates.test/v1",
    source: "reference-provider",
    fetch: recorder.fetch,
    random: () => 0,
  });
  return { recorder, source };
}

describe("ARC-05 reference port «exchange-rates»: working and test implementations", () => {
  it("ARC-05 FR 2: the port ships both implementations", () => {
    expect(typeof EXCHANGE_RATE_IMPLEMENTATIONS.test).toBe("function");
    expect(typeof EXCHANGE_RATE_IMPLEMENTATIONS.live).toBe("function");
  });

  it("ARC-05 FR 2: configuration selects the implementation; the default (local, CI) is the synthetic one, which never calls a provider", async () => {
    const config = loadConfig(
      {
        WS_DB_HOST: "localhost",
        WS_DB_NAME: "willowsum",
        WS_DB_PROBE_PASSWORD: "probe-secret-value-0001",
        WS_DB_CONTEXT_PASSWORD: "context-secret-value-01",
      },
      "api",
      [],
    );
    const liveOptions = vi.fn(() => ({ baseUrl: "https://rates.test", source: "x" }));
    const source = exchangeRateSource(config.providerMode, liveOptions);
    expect(liveOptions).not.toHaveBeenCalled();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const rates = await source.ratesOn(REQUEST);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rates.map((r) => [r.quote, r.source, r.date])).toEqual([
      ["USD", "synthetic", "2026-11-06"],
      ["UAH", "synthetic", "2026-11-06"],
    ]);
    fetchSpy.mockRestore();

    const liveSource = exchangeRateSource("live", liveOptions);
    expect(liveOptions).toHaveBeenCalledTimes(1);
    expect(liveSource).not.toBe(source);
  });

  it("synthetic rates are stable Decimals usable for conversion (never floats)", async () => {
    const a = await syntheticExchangeRates().ratesOn(REQUEST);
    const b = await syntheticExchangeRates().ratesOn({ ...REQUEST, quotes: ["UAH", "USD"] });
    expect(a[0]!.rate).toBeInstanceOf(Decimal);
    expect(a[0]!.rate.toFixed()).toMatch(/^[1-9]\.\d{6}$/);
    expect(b.find((r) => r.quote === "USD")!.rate.equals(a[0]!.rate)).toBe(true);
    const converted = convert(Money.of("100.00", "EUR"), a[0]!, "2026-11-06");
    expect(converted.to.currency).toBe("USD");
  });

  it("the working implementation reads decimal-string rates with their date and source", async () => {
    const { source, recorder } = live(() =>
      jsonResponse({ base: "EUR", date: "2026-11-05", rates: { USD: "1.081234", UAH: "45.1" } }),
    );
    const rates = await source.ratesOn(REQUEST);
    expect(recorder.requests[0]!.url).toBe(
      "https://rates.test/v1/rates?base=EUR&symbols=USD%2CUAH&date=2026-11-06",
    );
    expect(rates.map((r) => [r.quote, r.rate.toFixed(), r.date, r.source])).toEqual([
      ["USD", "1.081234", "2026-11-05", "reference-provider"],
      ["UAH", "45.1", "2026-11-05", "reference-provider"],
    ]);
  });

  it("ARC-05 FR 5: the working implementation sends only the declared fields (base, symbols, date)", async () => {
    const { source, recorder } = live(() =>
      jsonResponse({ base: "EUR", date: "2026-11-06", rates: { USD: "1.1", UAH: "45" } }),
    );
    await source.ratesOn(REQUEST);
    expect(EXCHANGE_RATES_PORT.operations.ratesOn.fields).toEqual(["base", "symbols", "date"]);
    expect(recorder.requests).toHaveLength(1);
    expect(await outgoingFieldViolations(EXCHANGE_RATES_PORT.operations.ratesOn, recorder.requests)).toEqual(
      [],
    );
  });

  it("an answer with float rates, a later date, another base or a missing quote is «invalid-response»", async () => {
    for (const body of [
      { base: "EUR", date: "2026-11-06", rates: { USD: 1.1, UAH: "45" } },
      { base: "EUR", date: "2026-11-07", rates: { USD: "1.1", UAH: "45" } },
      { base: "USD", date: "2026-11-06", rates: { USD: "1.1", UAH: "45" } },
      { base: "EUR", date: "2026-11-06", rates: { USD: "1.1" } },
      { base: "EUR", date: "2026-11-06", rates: { USD: "0", UAH: "45" } },
    ]) {
      const { source } = live(() => jsonResponse(body));
      await expect(source.ratesOn(REQUEST)).rejects.toMatchObject({ kind: "invalid-response" });
    }
  });

  it("ARC-05 FR 3: five broken 200 answers in a row open the breaker; the sixth call does not reach the provider", async () => {
    const { source, recorder } = live(() => jsonResponse({}));
    const results: unknown[] = [];
    for (let i = 0; i < 6; i += 1) results.push(await source.ratesOn(REQUEST).catch((e: unknown) => e));
    expect(results.map((e) => (e as { kind: string }).kind)).toEqual([
      "invalid-response",
      "invalid-response",
      "invalid-response",
      "invalid-response",
      "invalid-response",
      "circuit-open",
    ]);
    expect(recorder.requests).toHaveLength(5);
  });

  it("a requested date after today (UTC) is refused by both implementations, before any request", async () => {
    const { source, recorder } = live(() => jsonResponse({}));
    const tomorrow = { ...REQUEST, date: "2026-11-07" };
    await expect(source.ratesOn(tomorrow)).rejects.toThrow(/future/);
    await expect(syntheticExchangeRates().ratesOn(tomorrow)).rejects.toThrow(/future/);
    expect(recorder.requests).toEqual([]);
  });

  it("ARC-05 FR 4: when the provider fails, the last known rates are shown with their date", async () => {
    let up = true;
    const { source } = live(() =>
      up
        ? jsonResponse({ base: "EUR", date: "2026-11-06", rates: { USD: "1.1", UAH: "45" } })
        : new Response("", { status: 503 }),
    );
    const observed = withLastKnownRates(source);
    const fresh = await observed.ratesOn(REQUEST);
    expect(fresh).toMatchObject({ stale: false, asOf: "2026-11-06T10:00:00.000Z" });

    up = false;
    vi.setSystemTime(new Date("2026-11-06T18:00:00.000Z"));
    const pending = observed.ratesOn({ ...REQUEST, quotes: ["UAH", "USD"] });
    await vi.advanceTimersByTimeAsync(10_000);
    const stale = await pending;
    expect(stale.stale).toBe(true);
    expect(stale.asOf).toBe("2026-11-06T10:00:00.000Z");
    expect(stale.value.map((r) => [r.quote, r.rate.toFixed(), r.date])).toEqual([
      ["USD", "1.1", "2026-11-06"],
      ["UAH", "45", "2026-11-06"],
    ]);
  });

  it("invalid requests never reach the provider", async () => {
    const { source, recorder } = live(() => jsonResponse({}));
    await expect(source.ratesOn({ base: "EUR", quotes: ["EUR"], date: "2026-11-06" })).rejects.toThrow();
    await expect(source.ratesOn({ base: "XXX1", quotes: ["USD"], date: "2026-11-06" })).rejects.toThrow();
    await expect(source.ratesOn({ base: "EUR", quotes: [], date: "2026-11-06" })).rejects.toThrow();
    await expect(source.ratesOn({ base: "EUR", quotes: ["USD"], date: "6.11.2026" })).rejects.toThrow();
    expect(recorder.requests).toEqual([]);
  });
});
