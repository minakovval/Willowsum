import { describe, expect, it } from "vitest";
import {
  AmountOutOfRangeError,
  CurrencyMismatchError,
  Decimal,
  InvalidRateError,
  Money,
  convert,
  currencyInfo,
  exchangeRate,
  knownCurrencies,
  sumMoney,
} from "./index.ts";

describe("NFR-06 FR 1, FR 3: amounts in their original unit — ISO 4217, metals, crypto", () => {
  it("knows ISO 4217 minor units", () => {
    expect(currencyInfo("EUR")).toEqual({ code: "EUR", kind: "fiat", minorUnits: 2 });
    expect(currencyInfo("UAH").minorUnits).toBe(2);
    expect(currencyInfo("JPY").minorUnits).toBe(0);
    expect(currencyInfo("KWD").minorUnits).toBe(3);
    expect(currencyInfo("CLF").minorUnits).toBe(4);
    expect(knownCurrencies().filter((c) => c.kind === "fiat").length).toBeGreaterThan(150);
  });

  it("holds gold and silver as their own units, and crypto with up to 18 decimals", () => {
    expect(currencyInfo("XAU").kind).toBe("metal");
    expect(currencyInfo("XAG").kind).toBe("metal");
    expect(currencyInfo("ETH")).toEqual({ code: "ETH", kind: "crypto", minorUnits: 18 });
    expect(currencyInfo("BTC").minorUnits).toBe(8);
    expect(Money.of("0.000000000000000001", "ETH").toDecimalString()).toBe("0.000000000000000001");
    expect(Money.of("1.5", "XAU").currency).toBe("XAU");
    expect(knownCurrencies().every((c) => c.minorUnits >= 0 && c.minorUnits <= 18)).toBe(true);
  });

  it("refuses unknown units", () => {
    expect(() => Money.of("1", "ABC")).toThrow(/Unknown currency/);
    expect(() => Money.of("1", "eur")).toThrow(/Unknown currency/);
  });
});

describe("NFR-06 FR 2: rounding only for display, banker's rounding to the currency's minor units", () => {
  it("keeps the stored value exact and rounds half to even when shown", () => {
    const a = Money.of("2.345", "EUR");
    expect(a.toDisplayDecimal().toFixed()).toBe("2.34");
    expect(a.toDecimalString()).toBe("2.345");
    expect(Money.of("2.355", "EUR").toDisplayDecimal().toFixed()).toBe("2.36");
    expect(Money.of("1234.5", "JPY").toDisplayDecimal().toFixed()).toBe("1234");
    expect(Money.of("1.2345", "KWD").toDisplayDecimal().toFixed()).toBe("1.234");
    expect(Money.of("-0.125", "EUR").toDisplayDecimal().toFixed()).toBe("-0.12");
  });
});

describe("NFR-06 FR 4: every conversion keeps its rate, the rate's date and its source", () => {
  const usdEur = exchangeRate({
    base: "USD",
    quote: "EUR",
    rate: "0.9215",
    date: "2026-11-05",
    source: "ECB",
  });

  it("records rate, date and source; the result is exact", () => {
    const c = convert(Money.of("100.10", "USD"), usdEur, "2026-11-05");
    expect(c.to.toJSON()).toEqual({ amount: "92.24215", currency: "EUR" });
    expect(c.rate.toFixed()).toBe("0.9215");
    expect(c.rateDate).toBe("2026-11-05");
    expect(c.source).toBe("ECB");
    expect(c.approximate).toBe(false);
    expect(c.from.toJSON()).toEqual({ amount: "100.1", currency: "USD" });
  });

  it("edge case: no rate for the date — the nearest earlier rate is used and the result is marked with the rate date", () => {
    const c = convert(Money.of("50", "USD"), usdEur, "2026-11-07");
    expect(c.approximate).toBe(true);
    expect(c.rateDate).toBe("2026-11-05");
    expect(c.requestedDate).toBe("2026-11-07");
    expect(() => convert(Money.of("50", "USD"), usdEur, "2026-11-04")).toThrow(/after the requested date/);
  });

  it("refuses rates without a source, a valid date or a positive value, and a wrong base currency", () => {
    const base = { base: "USD", quote: "EUR", date: "2026-11-05", source: "ECB" };
    expect(() => exchangeRate({ ...base, rate: "0" })).toThrow(InvalidRateError);
    expect(() => exchangeRate({ ...base, rate: "-1" })).toThrow(InvalidRateError);
    expect(() => exchangeRate({ ...base, rate: new Decimal(NaN) })).toThrow(InvalidRateError);
    expect(() => exchangeRate({ ...base, rate: "1", source: " " })).toThrow(/source/);
    expect(() => exchangeRate({ ...base, rate: "1", date: "05.11.2026" })).toThrow(/YYYY-MM-DD/);
    expect(() => exchangeRate({ ...base, rate: "1", quote: "USD" })).toThrow(/two different/);
    expect(() => convert(Money.of("1", "UAH"), usdEur, "2026-11-05")).toThrow(/base currency/);
    expect(() => exchangeRate({ ...base, rate: "1", quote: "ABC" })).toThrow(/known units/);
    expect(() => exchangeRate({ ...base, rate: "1e3" })).toThrow(/positive decimal string/);
    expect(() => exchangeRate({ ...base, rate: "0." + "1".repeat(19) })).toThrow(/at most 18 decimals/);
  });

  it("convert checks a hand-built rate too: no negative rate, empty date or empty source gets through", () => {
    const amount = Money.of("10", "USD");
    const forged = { base: "USD", quote: "EUR", rate: new Decimal("-2"), date: "", source: "" };
    expect(() => convert(amount, forged, "2026-11-05")).toThrow(InvalidRateError);
    expect(() =>
      convert(amount, { ...forged, rate: new Decimal("2"), date: "2026-11-05" }, "2026-11-05"),
    ).toThrow(/source/);
    expect(() => convert(amount, { ...forged, rate: new Decimal("2"), source: "ECB" }, "2026-11-05")).toThrow(
      /YYYY-MM-DD/,
    );
    expect(() =>
      convert(amount, { ...forged, rate: "2" as never, date: "2026-11-05", source: "ECB" }, "2026-11-05"),
    ).toThrow(/positive finite decimal/);
  });
});

describe("NFR-06 FR 9: out-of-range results are validation errors", () => {
  it("an overflowing conversion throws AmountOutOfRangeError, not a crash", () => {
    const huge = exchangeRate({
      base: "IRR",
      quote: "EUR",
      rate: "1000000",
      date: "2026-11-05",
      source: "test",
    });
    expect(() => convert(Money.of("9".repeat(20), "IRR"), huge, "2026-11-05")).toThrow(AmountOutOfRangeError);
    const err = (() => {
      try {
        Money.of("1".padEnd(22, "0"), "EUR");
      } catch (e) {
        return e as { code?: string };
      }
      return {};
    })();
    expect(err.code).toBe("AMOUNT_OUT_OF_RANGE");
  });

  it("a conversion result is kept at the 18-decimal storage scale, not rounded to the currency", () => {
    const r = exchangeRate({
      base: "EUR",
      quote: "UAH",
      rate: "48.123456789012345675",
      date: "2026-11-05",
      source: "NBU",
    });
    expect(convert(Money.of("0.1", "EUR"), r, "2026-11-05").to.toDecimalString()).toBe(
      "4.812345678901234568",
    );
  });
});

describe("NFR-06 acceptance 1: net worth in 3 currencies matches the manual calculation", () => {
  it("EUR + USD + UAH converted at dated rates equals the hand-computed total to the last cent", () => {
    // Manual: 1 250.40 EUR + 3 000.00 USD × 0.9215 + 125 000.00 UAH × 0.0205 = 1 250.40 + 2 764.50 + 2 562.50 = 6 577.40 EUR
    const date = "2026-11-05";
    const usd = exchangeRate({ base: "USD", quote: "EUR", rate: "0.9215", date, source: "ECB" });
    const uah = exchangeRate({ base: "UAH", quote: "EUR", rate: "0.0205", date, source: "NBU" });
    const parts = [
      Money.of("1250.40", "EUR"),
      convert(Money.of("3000.00", "USD"), usd, date).to,
      convert(Money.of("125000.00", "UAH"), uah, date).to,
    ];
    const total = sumMoney(parts, "EUR");
    expect(total.toDisplayDecimal().toFixed(2)).toBe("6577.40");
    expect(() => sumMoney([Money.of("1", "EUR"), Money.of("1", "USD")], "EUR")).toThrow(
      CurrencyMismatchError,
    );
  });
});
