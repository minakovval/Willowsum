import { Decimal } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  crossRate,
  kyivDate,
  retryDelayMs,
  RateUnavailableError,
  staleAlertMessage,
  stalePeriodKey,
} from "./index.ts";

const HOUR = 60 * 60 * 1000;
const day = new Map([
  ["EUR", new Decimal("45.00")],
  ["PLN", new Decimal("11.25")],
  ["USD", new Decimal("41.4321")],
]);

describe("VAL-05@PoC domain: cross rates through the hryvnia and the retry pauses", () => {
  it("VAL-05 AC5: 1 EUR = 45.00 UAH and 1 PLN = 11.25 UAH give 1 PLN = 0.25 EUR, source NBU, date D", () => {
    const r = crossRate("PLN", "EUR", "2026-11-12", "NBU", day);
    expect([r.base, r.quote, r.rate.toFixed(), r.date, r.source]).toEqual([
      "PLN",
      "EUR",
      "0.25",
      "2026-11-12",
      "NBU",
    ]);
    expect(crossRate("EUR", "PLN", "2026-11-12", "NBU", day).rate.toFixed()).toBe("4");
  });

  it("VAL-05 FR3: the hryvnia is the pivot (rate 1); a non-terminating quotient keeps 18 decimals, as a Decimal", () => {
    expect(crossRate("EUR", "UAH", "2026-11-12", "NBU", day).rate.toFixed()).toBe("45");
    expect(crossRate("UAH", "PLN", "2026-11-12", "NBU", day).rate.toFixed()).toBe("0.088888888888888889");
    const usdEur = crossRate("USD", "EUR", "2026-11-12", "NBU", day);
    expect(usdEur.rate).toBeInstanceOf(Decimal);
    expect(usdEur.rate.toFixed()).toBe("0.920713333333333333");
  });

  it("VAL-05 FR3: a currency without an official rate on that date has no cross rate", () => {
    expect(() => crossRate("GBP", "EUR", "2026-11-12", "NBU", day)).toThrow(RateUnavailableError);
  });

  it("VAL-05 FR4: three short retries, then 1 h, 2 h, 4 h … doubling, never more than 24 h", () => {
    expect([1, 2].map(retryDelayMs)).toEqual([15 * 60 * 1000, 15 * 60 * 1000]);
    expect([3, 4, 5, 6, 7, 8, 9, 50].map((n) => retryDelayMs(n) / HOUR)).toEqual([
      1, 2, 4, 8, 16, 24, 24, 24,
    ]);
    expect(retryDelayMs(0) / HOUR).toBe(24);
  });

  it("VAL-05 FR1: the rates date is the calendar date in Kyiv", () => {
    expect(kyivDate(Date.UTC(2026, 10, 11, 22, 30))).toBe("2026-11-12");
    expect(kyivDate(Date.UTC(2026, 10, 12, 21, 59))).toBe("2026-11-12");
  });

  it("VAL-05 FR4: the alert letter states facts only — no amounts, rates or currencies", () => {
    const letter = staleAlertMessage({ lastSuccessAt: Date.UTC(2026, 10, 12, 14, 0, 0, 0), failures: 7 });
    expect(letter.subject).toBe("Willowsum: курси валют не оновлювалися понад 24 год");
    expect(letter.text).toContain("Останнє успішне оновлення: 2026-11-12 14:00 UTC.");
    expect(letter.text).toContain("Невдалих спроб поспіль: 7.");
    const all = `${letter.subject}\n${letter.text}`;
    expect(all).not.toMatch(/\d+[.,]\d+/);
    expect(all).not.toMatch(/[$€£₴]|\b(UAH|EUR|USD|PLN|GBP|CHF|грн)\b/i);
    expect(staleAlertMessage({ lastSuccessAt: null, failures: 3 }).text).toContain(
      "Успішного оновлення ще не було.",
    );
  });

  it("VAL-05 FR4: a stale period is keyed by the last successful update", () => {
    expect(stalePeriodKey(null)).toBe("never");
    expect(stalePeriodKey(Date.UTC(2026, 10, 12, 14, 0))).toBe("2026-11-12T14:00:00.000Z");
  });
});
