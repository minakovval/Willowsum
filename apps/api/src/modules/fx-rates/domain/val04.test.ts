import { Money, currencyInfo } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  REPORTING_CURRENCY,
  RESTRICTED_CONVERTIBILITY,
  isRestrictedConvertibility,
  rateCoversDate,
} from "./index.ts";

/** VAL-04@PoC, pure rules of fx-rates: the space's reporting currency, ISO 4217, weekends, restricted currencies. */
describe("VAL-04@PoC domain: currencies of the space and the rate of a date", () => {
  it("VAL-04@PoC FR 2: the reporting currency of a space in this release is EUR, whatever the locale", () => {
    expect(REPORTING_CURRENCY).toBe("EUR");
    expect(currencyInfo(REPORTING_CURRENCY).kind).toBe("fiat");
  });

  it("VAL-04@PoC FR 5: ISO 4217 currencies are supported with their own precision; an unknown code is refused", () => {
    expect(["EUR", "UAH", "USD", "PLN", "CHF", "GBP"].map((c) => currencyInfo(c).minorUnits)).toEqual([
      2, 2, 2, 2, 2, 2,
    ]);
    expect(currencyInfo("JPY").minorUnits).toBe(0);
    expect(currencyInfo("KWD").minorUnits).toBe(3);
    expect(Money.of("1000000", "UAH").currency).toBe("UAH");
    expect(() => Money.of("1", "ABC")).toThrow(/Unknown currency/);
  });

  it("VAL-04@PoC AC4: the rate of a Saturday is Friday's rate, and it counts as the rate of that date", () => {
    // 2026-11-14 is a Saturday, 2026-11-13 the Friday before it.
    expect(rateCoversDate("2026-11-13", "2026-11-14")).toBe(true);
    expect(rateCoversDate("2026-11-14", "2026-11-14")).toBe(true);
  });

  it("VAL-04@PoC EC1: weekends take the previous working day's rate (Sunday → Friday); a working day between is not covered", () => {
    expect(rateCoversDate("2026-11-13", "2026-11-15")).toBe(true); // Friday → Sunday
    expect(rateCoversDate("2026-11-14", "2026-11-15")).toBe(true); // Saturday → Sunday
    expect(rateCoversDate("2026-11-13", "2026-11-16")).toBe(false); // Friday → Monday: Monday has its own rate
    expect(rateCoversDate("2026-11-12", "2026-11-14")).toBe(false); // Thursday → Saturday: Friday is missing
    expect(rateCoversDate("2026-10-01", "2026-11-14")).toBe(false);
    // A rate from after the date never covers it.
    expect(rateCoversDate("2026-11-16", "2026-11-15")).toBe(false);
    // Across a month and a year end: Friday 2027-01-01 → Sunday 2027-01-03.
    expect(rateCoversDate("2027-01-01", "2027-01-03")).toBe(true);
  });

  it("VAL-04@PoC EC2: a currency with restricted convertibility gets the official rate with a warning", () => {
    expect(isRestrictedConvertibility("BYN")).toBe(true);
    expect(isRestrictedConvertibility("EUR")).toBe(false);
    expect(isRestrictedConvertibility("UAH")).toBe(false);
    for (const code of RESTRICTED_CONVERTIBILITY) expect(currencyInfo(code).kind).toBe("fiat");
  });
});
