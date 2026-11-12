import { describe, expect, it } from "vitest";
import type { AdapterClock } from "../../../../platform/adapters/index.ts";
import { recordingFetch } from "../../../../platform/adapters/testing.ts";
import { nbuRateFeed, parseNbuRates } from "./index.ts";

/** Security review of PR #120: a malformed or hostile NBU answer never reaches the rate history. */
const T = Date.UTC(2026, 10, 12, 14, 0);
const instantClock: AdapterClock = {
  now: () => T,
  setTimeout: (callback, ms) => {
    if (ms < 10_000) queueMicrotask(callback);
    return 0;
  },
  clearTimeout: () => undefined,
};
const row = (cc: string, rate: string, date = "12.11.2026") =>
  `{"cc":"${cc}","rate":${rate},"exchangedate":"${date}"}`;
const body = (...rows: string[]) => `[${rows.join(",")}]`;

describe("sec#120: NBU answer validation", () => {
  it("only the NBU host is called, with only the date in the query; no redirect is followed", async () => {
    const rec = recordingFetch(
      () => new Response(null, { status: 302, headers: { location: "https://evil.test/" } }),
    );
    const feed = nbuRateFeed({ fetch: rec.fetch, clock: instantClock, random: () => 0 });
    await expect(feed.dailyRates("2026-11-12")).rejects.toMatchObject({ kind: "rejected" });
    expect(rec.requests.map((r) => [new URL(r.url).host, r.redirect])).toEqual([["bank.gov.ua", "manual"]]);
    await expect(feed.dailyRates("2026-11-12&x=1")).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("zero, negative, exponent, string and non-finite rates are refused", () => {
    for (const rate of ["0", "0.000", "-45", "4.5e1", '"45"', "null", "1E400"])
      expect(() => parseNbuRates(body(row("EUR", rate)), "2026-11-12"), rate).toThrow();
  });

  it("unknown units and the hryvnia itself are skipped, never stored", () => {
    const rates = parseNbuRates(body(row("XDR", "56.1"), row("UAH", "1"), row("EUR", "45")), "2026-11-12");
    expect(rates.map((r) => r.currency)).toEqual(["EUR"]);
  });

  // Non-blocking findings of the review, fixed in parseNbuRates.
  it("a rate too large for NUMERIC(38,18) is refused by the parser, not by a database overflow", () => {
    expect(() => parseNbuRates(body(row("EUR", "1" + "0".repeat(25))), "2026-11-12")).toThrow();
  });

  it("a rate with more than 18 decimals is refused (the database would round it, maybe to 0)", () => {
    expect(() => parseNbuRates(body(row("EUR", "0.0000000000000000004")), "2026-11-12")).toThrow();
  });

  // Still open: passes while the parser accepts an earlier date. The reviewer asked to check the live NBU feed on a
  // weekend or holiday date first (it may answer with the last working day's rates). Follow-up for the first
  // deployment: query the live feed for such a date, then require the asked date or record why not.
  it.fails(
    "an answer for another (earlier) date than asked is refused: it would overwrite stored history",
    () => {
      expect(() => parseNbuRates(body(row("EUR", "45", "01.01.2020")), "2026-11-12")).toThrow();
    },
  );

  it("a currency listed twice in one answer is refused", () => {
    expect(() => parseNbuRates(body(row("EUR", "45"), row("EUR", "4500")), "2026-11-12")).toThrow();
  });
});
