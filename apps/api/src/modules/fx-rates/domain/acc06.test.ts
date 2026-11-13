import { Decimal, Money, convert } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  FIXED_CONVERSIONS,
  FIXED_CONVERSION_SOURCE,
  fixedConversionRate,
  rateCoversDate,
  type FixedConversion,
} from "./index.ts";

/** ACC-06@PoC, pure rules of fx-rates: the directory of currency replacements (business rules, edge case 2). */
describe("ACC-06@PoC domain: the directory of currency replacements", () => {
  it("ACC-06@PoC EC2: from 2026-01-01 BGN converts to EUR at the fixed rate 1.95583 BGN = 1 EUR, source «EU»", () => {
    const rate = fixedConversionRate("BGN", "EUR", "2026-11-16");
    expect(rate).not.toBeNull();
    expect([rate!.base, rate!.quote, rate!.source]).toEqual(["BGN", "EUR", FIXED_CONVERSION_SOURCE]);
    // The reciprocal at 18 decimals, half to even: no float anywhere.
    expect(rate!.rate.toFixed()).toBe(
      new Decimal("1").dividedBy("1.95583").toDecimalPlaces(18, Decimal.ROUND_HALF_EVEN).toFixed(),
    );
    const c = convert(Money.of("195.583", "BGN"), rate!, "2026-11-16");
    expect(c.to.currency).toBe("EUR");
    expect(c.to.amount.toDecimalPlaces(2).toFixed(2)).toBe("100.00");
    // The other way round is the published rate itself.
    expect(fixedConversionRate("EUR", "BGN", "2026-01-01")!.rate.toFixed()).toBe("1.95583");
  });

  it("ACC-06@PoC EC2: the fixed rate is the rate of the date asked for — never «приблизно», whatever the day", () => {
    for (const date of ["2026-01-01", "2026-03-14", "2026-11-16"]) {
      const rate = fixedConversionRate("BGN", "EUR", date)!;
      expect(rate.date).toBe(date);
      expect(rateCoversDate(rate.date, date)).toBe(true);
    }
  });

  it("ACC-06@PoC EC2: before the changeover, and for any other pair, the directory gives nothing (the official rate applies)", () => {
    expect(fixedConversionRate("BGN", "EUR", "2025-12-31")).toBeNull();
    expect(fixedConversionRate("BGN", "USD", "2026-11-16")).toBeNull();
    expect(fixedConversionRate("USD", "EUR", "2026-11-16")).toBeNull();
    expect(fixedConversionRate("UAH", "EUR", "2026-11-16")).toBeNull();
  });

  it("ACC-06@PoC business rules: every row of the directory is a valid rate between known units", () => {
    for (const entry of FIXED_CONVERSIONS) {
      expect(fixedConversionRate(entry.currency, entry.successor, entry.since)).not.toBeNull();
      expect(fixedConversionRate(entry.successor, entry.currency, entry.since)).not.toBeNull();
    }
    // A directory row is data: another (synthetic) row is found the same way.
    const other: FixedConversion[] = [
      { currency: "ANG", successor: "XCG", unitsPerSuccessor: "1", since: "2025-04-01" },
    ];
    expect(fixedConversionRate("ANG", "XCG", "2025-04-01", other)!.rate.toFixed()).toBe("1");
    expect(fixedConversionRate("ANG", "XCG", "2025-03-31", other)).toBeNull();
  });
});
