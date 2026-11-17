import { exchangeRate, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { creditFitsJournal, transferReceived } from "./transfers.ts";

const DATE = "2026-10-14";
const rate = (quote: string, r: string) =>
  exchangeRate({ base: "EUR", quote, rate: r, date: DATE, source: "NBU" });
const eur = (a: string) => Money.of(a, "EUR");

// Security review of PR #456: the boundary of the overflow guard, without I/O. Synthetic amounts and rates.
describe("sec456: transferReceived at the stored size (NUMERIC(38,18))", () => {
  it("sec456: the converted credit of exactly 20 integer digits is kept; one cent more is a field issue", () => {
    expect(transferReceived(eur("2298850574712643678.16"), "UAH", null, rate("UAH", "43.5"), DATE)).toEqual(
      Money.of("99999999999999999999.96", "UAH"),
    );
    expect(transferReceived(eur("2298850574712643678.17"), "UAH", null, rate("UAH", "43.5"), DATE)).toEqual({
      field: "amount",
      issue: "invalid",
    });
  });
  it("sec456: a credit that leaves the stored size only when rounded to the minor units is a field issue too", () => {
    // 99999999999999999999.99 at rate 1 fits; rounded to JPY's 0 decimals it is 21 digits.
    expect(transferReceived(eur("99999999999999999999.99"), "JPY", null, rate("JPY", "1"), DATE)).toEqual({
      field: "amount",
      issue: "invalid",
    });
    expect(transferReceived(eur("99999999999999999999.49"), "JPY", null, rate("JPY", "1"), DATE)).toEqual(
      Money.of("99999999999999999999", "JPY"),
    );
  });
  it("sec456: another domain error of the conversion is not turned into a field issue", () => {
    expect(() => transferReceived(eur("1.00"), "UAH", null, rate("UAH", "43.5"), "2026-10-13")).toThrow();
    expect(() =>
      transferReceived(eur("1.00"), "UAH", null, { ...rate("UAH", "43.5"), base: "USD" }, DATE),
    ).toThrow();
  });
  it("sec456: the journal's conversion of the credit into the debit's currency is checked at the same size", () => {
    expect(creditFitsJournal(eur("2298850574712643678.16"), rate("UAH", "43.5"), DATE)).toBe(true);
    expect(creditFitsJournal(eur("2298850574712643678.17"), rate("UAH", "43.5"), DATE)).toBe(false);
    expect(() => creditFitsJournal(eur("1.00"), rate("UAH", "43.5"), "2026-10-13")).toThrow();
  });
});
