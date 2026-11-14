import { Money, currencyInfo, isCalendarDate } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  REPORTING_CURRENCY,
  RESTRICTED_CONVERTIBILITY,
  isRestrictedConvertibility,
  TODAY_RATE_MAX_AGE_DAYS,
  rateCoversDate,
  todayRateIsApproximate,
} from "./index.ts";

/**
 * VAL-04@PoC, pure rules of fx-rates: the space's reporting currency, ISO 4217, weekends, the age of «today»'s rate,
 * restricted currencies.
 */
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

  it("VAL-04@PoC FR 3: only a real calendar date written YYYY-MM-DD is a date", () => {
    expect(isCalendarDate("2026-11-14")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    for (const bad of ["today", "2026-02-30", "2027-02-29", "2026-13-01", "2026-1-1", "14.11.2026", ""])
      expect(isCalendarDate(bad), bad).toBe(false);
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

  it("VAL-04@PoC AC5: on Monday, Friday's rate (3 calendar days) is not «приблизно», Wednesday's (5 days) is", () => {
    // 2026-11-16 is a Monday.
    expect(todayRateIsApproximate("2026-11-13", "2026-11-16")).toBe(false);
    expect(todayRateIsApproximate("2026-11-11", "2026-11-16")).toBe(true);
  });

  it("VAL-04@PoC EC2: «today» is «приблизно» only when the latest rate is older than 3 calendar days; exactly 3 is not", () => {
    expect(TODAY_RATE_MAX_AGE_DAYS).toBe(3);
    expect(todayRateIsApproximate("2026-11-16", "2026-11-16")).toBe(false); // today's own rate
    expect(todayRateIsApproximate("2026-11-15", "2026-11-16")).toBe(false); // 1 day
    expect(todayRateIsApproximate("2026-11-14", "2026-11-17")).toBe(false); // 3 days, Saturday → Tuesday
    expect(todayRateIsApproximate("2026-11-13", "2026-11-17")).toBe(true); // 4 days, Friday → Tuesday
    // Calendar days, weekends included: Wednesday → Sunday is 4 days.
    expect(todayRateIsApproximate("2026-11-11", "2026-11-15")).toBe(true);
    // Across a month and a year end, and a leap day.
    expect(todayRateIsApproximate("2026-12-29", "2027-01-01")).toBe(false);
    expect(todayRateIsApproximate("2026-12-28", "2027-01-01")).toBe(true);
    expect(todayRateIsApproximate("2028-02-27", "2028-03-01")).toBe(false); // 27.02 → 01.03 is 3 days in 2028
    expect(todayRateIsApproximate("2027-02-26", "2027-03-01")).toBe(false);
    expect(todayRateIsApproximate("2027-02-25", "2027-03-01")).toBe(true);
    // A rate from after today never arrives here (`convert` refuses it); it is not «older».
    expect(todayRateIsApproximate("2026-11-17", "2026-11-16")).toBe(false);
  });

  it("VAL-04@PoC EC3: a currency with restricted convertibility gets the official rate with a warning", () => {
    expect(isRestrictedConvertibility("BYN")).toBe(true);
    expect(isRestrictedConvertibility("EUR")).toBe(false);
    expect(isRestrictedConvertibility("UAH")).toBe(false);
    for (const code of RESTRICTED_CONVERTIBILITY) expect(currencyInfo(code).kind).toBe("fiat");
  });
});
