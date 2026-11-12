import { readFileSync } from "node:fs";
import { Decimal } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { outgoingFieldViolations, type AdapterClock } from "../../../../platform/adapters/index.ts";
import { recordingFetch } from "../../../../platform/adapters/testing.ts";
import {
  FX_RATE_FEEDS,
  fxRateFeed,
  nbuRateFeed,
  OFFICIAL_RATES_PORT,
  parseNbuRates,
  syntheticRateFeed,
} from "./index.ts";

/** A recorded answer of the NBU feed (format of the real answer; the values are invented). */
const RECORDED = readFileSync(new URL("./fixtures/nbu-exchange-2026-11-12.json", import.meta.url), "utf8");
const T = Date.UTC(2026, 10, 12, 14, 0);

/** Retry pauses (≤ 2 s) fire at once and take no real time; the 10 s call time limit never fires. */
const instantClock: AdapterClock = {
  now: () => T,
  setTimeout: (callback, ms) => {
    if (ms < 10_000) queueMicrotask(callback);
    return 0;
  },
  clearTimeout: () => undefined,
};

function live(answer: (r: Request) => Response) {
  const recorder = recordingFetch(answer);
  return { recorder, feed: nbuRateFeed({ fetch: recorder.fetch, clock: instantClock, random: () => 0 }) };
}

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

describe("VAL-05@PoC: the NBU adapter (ARC-05) and the synthetic feed", () => {
  it("VAL-05 FR3: the official rates come from the NBU as Decimals read from the answer's text, source NBU and their date", async () => {
    const { feed, recorder } = live(() => text(RECORDED));
    const rates = await feed.dailyRates("2026-11-12");
    expect(recorder.requests.map((r) => r.url)).toEqual([
      "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=20261112&json=",
    ]);
    expect(rates.map((r) => [r.currency, r.rate.toFixed(), r.date, r.source])).toEqual([
      ["USD", "41.4321", "2026-11-12", "NBU"],
      ["EUR", "45", "2026-11-12", "NBU"],
      ["PLN", "11.25", "2026-11-12", "NBU"],
      ["JPY", "0.27013", "2026-11-12", "NBU"],
      ["XAU", "110385.17", "2026-11-12", "NBU"],
    ]);
    expect(rates.every((r) => r.rate instanceof Decimal)).toBe(true);
  });

  it("VAL-05 FR3: a rate a float cannot hold exactly stays exact (never through a JS number)", () => {
    const [r] = parseNbuRates(
      '[{"cc":"USD","rate":41.123456789012345678,"exchangedate":"12.11.2026"}]',
      "2026-11-12",
    );
    expect(r!.rate.toFixed()).toBe("41.123456789012345678");
  });

  it("ARC-05 FR5: the NBU adapter sends only the date and the format, nothing about a space", async () => {
    const { feed, recorder } = live(() => text(RECORDED));
    await feed.dailyRates("2026-11-12");
    expect(OFFICIAL_RATES_PORT.operations.dailyRates.fields).toEqual(["date", "json"]);
    expect(
      await outgoingFieldViolations(OFFICIAL_RATES_PORT.operations.dailyRates, recorder.requests),
    ).toEqual([]);
  });

  it("VAL-05 FR3: an answer of a later date, an empty list, a malformed rate or a broken body is «invalid-response»", async () => {
    for (const body of [
      '[{"cc":"EUR","rate":45.1,"exchangedate":"13.11.2026"}]',
      "[]",
      '[{"cc":"EUR","rate":"45","exchangedate":"12.11.2026"}]',
      '[{"cc":"EUR","rate":-1,"exchangedate":"12.11.2026"}]',
      '[{"cc":"EUR","rate":1e2,"exchangedate":"12.11.2026"}]',
      "<html>",
    ]) {
      const { feed } = live(() => text(body));
      await expect(feed.dailyRates("2026-11-12")).rejects.toMatchObject({ kind: "invalid-response" });
    }
  });

  it("VAL-05 FR4: an unavailable NBU is retried by the adapter, then reported as «unavailable»", async () => {
    const { feed, recorder } = live(() => text("", 503));
    await expect(feed.dailyRates("2026-11-12")).rejects.toMatchObject({ kind: "unavailable" });
    expect(recorder.requests).toHaveLength(3);
  });

  it("VAL-05 FR5: configuration selects the feed; the default (local, CI) is synthetic and never calls a provider", async () => {
    expect(FX_RATE_FEEDS.live).toBe(nbuRateFeed);
    expect(fxRateFeed("test").name).toBe("synthetic");
    expect(fxRateFeed("live").name).toBe("nbu");
    const a = await syntheticRateFeed().dailyRates("2026-11-12");
    const b = await syntheticRateFeed().dailyRates("2026-11-12");
    expect(a.map((r) => r.rate.toFixed())).toEqual(b.map((r) => r.rate.toFixed()));
    expect(a.every((r) => r.source === "synthetic" && r.date === "2026-11-12")).toBe(true);
  });
});
