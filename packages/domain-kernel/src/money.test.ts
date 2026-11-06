import { describe, expect, it } from "vitest";
import {
  AmountOutOfRangeError,
  CurrencyMismatchError,
  Decimal,
  Money,
  currencyCode,
  sumMoney,
} from "./index.ts";
import { isId, newId, parseId } from "./index.ts";

describe("Money (ARC-01 kernel, AGENTS.md «Money»)", () => {
  it("adds decimal amounts exactly (0.1 + 0.2 = 0.3)", () => {
    expect(Money.of("0.1", "EUR").plus(Money.of("0.2", "EUR")).toDecimalString()).toBe("0.3");
  });

  it("keeps 18 fraction digits (NUMERIC(38,18), ARC-03)", () => {
    const a = Money.of("0.000000000000000001", "ETH");
    expect(a.plus(a).toDecimalString()).toBe("0.000000000000000002");
  });

  it("refuses to combine currencies without a dated rate", () => {
    expect(() => Money.of("1", "EUR").plus(Money.of("1", "UAH"))).toThrow(CurrencyMismatchError);
    expect(() => Money.of("1", "EUR").compare(Money.of("1", "USD"))).toThrow(CurrencyMismatchError);
  });

  it("is created only from decimal strings or Decimal, never from a JS number", () => {
    // @ts-expect-error — a number is not accepted at the type level either.
    expect(() => Money.of(0.1, "EUR")).toThrow("Amount must be a decimal string or a Decimal");
    for (const bad of ["1e3", "1,5", " 1", "01", "+1", "", ".5", "NaN", "Infinity"]) {
      expect(() => Money.of(bad, "EUR"), bad).toThrow("plain decimal string");
    }
    expect(Money.of(new Decimal("12.50"), "EUR").toDecimalString()).toBe("12.5");
    for (const bad of [new Decimal(NaN), new Decimal(Infinity), new Decimal(-Infinity)]) {
      expect(() => Money.of(bad, "EUR")).toThrow("finite");
    }
  });

  it("rejects amounts that do not fit NUMERIC(38,18)", () => {
    expect(() => Money.of("1".padEnd(21, "0"), "EUR")).toThrow(AmountOutOfRangeError);
    expect(() => Money.of("0." + "1".repeat(19), "EUR")).toThrow(AmountOutOfRangeError);
    expect(Money.of("9".repeat(20) + "." + "9".repeat(18), "EUR").toDecimalString()).toHaveLength(39);
    const max = Money.of("9".repeat(20), "EUR");
    expect(() => max.plus(Money.of("1", "EUR"))).toThrow(AmountOutOfRangeError);
  });

  it("validates currency codes", () => {
    expect(currencyCode("EUR")).toBe("EUR");
    for (const bad of ["eur", "EU", "EURO", "€"])
      expect(() => currencyCode(bad), bad).toThrow(/three letters/);
  });

  it("negates, compares, sums and serialises", () => {
    const a = Money.of("-125.00", "EUR");
    expect(a.isNegative()).toBe(true);
    expect(a.negated().toDecimalString()).toBe("125");
    expect(Money.zero("EUR").isNegative()).toBe(false);
    expect(Money.of("2", "EUR").compare(Money.of("10", "EUR"))).toBe(-1);
    expect(a.equals(Money.of("-125", "EUR"))).toBe(true);
    expect(sumMoney([Money.of("1.10", "EUR"), Money.of("2.20", "EUR")], "EUR").toJSON()).toEqual({
      amount: "3.3",
      currency: "EUR",
    });
    expect(sumMoney([], "UAH").toJSON()).toEqual({ amount: "0", currency: "UAH" });
  });
});

describe("Ids", () => {
  it("creates and parses random UUIDs", () => {
    const id = newId<"household">();
    expect(isId(id)).toBe(true);
    expect(parseId<"household">(id)).toBe(id);
    expect(parseId("not-an-id")).toBeNull();
    expect(newId()).not.toBe(newId());
  });
});
