import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { availableCredit, checkTerms, parseAnnualRate, parseTypedAmount } from "./index.ts";

/** FIN-01@PoC FR 2, FR 3, FR 5, FR 16 on the pure rules of liabilities: a loan's and a credit card's terms. */

const eur = (amount: string) => Money.of(amount, "EUR");

describe("FIN-01@PoC FR 2: a loan («Кредит») is a liability with its rate and monthly payment", () => {
  it("FIN-01@PoC AC18: «Іпотека» at 4,2 % with 650,00 € a month is accepted", () => {
    const result = checkTerms({ kind: "loan", currency: "EUR", annualRate: "4.2", monthlyPayment: "650.00" });
    expect(result).toEqual({
      terms: {
        kind: "loan",
        currency: "EUR",
        annualRate: "4.2",
        monthlyPayment: eur("650"),
        creditLimit: null,
        gracePeriodDays: null,
      },
    });
  });

  it("FIN-01@PoC FR 5: a loan without a rate or a monthly payment is refused", () => {
    expect(checkTerms({ kind: "loan", currency: "EUR" })).toEqual({
      issues: [
        { field: "annualRate", issue: "required" },
        { field: "monthlyPayment", issue: "required" },
      ],
    });
  });

  it("FIN-01@PoC FR 3: the rate is 0–100 with two decimals, the payment more than 0 in the account's currency", () => {
    for (const annualRate of ["100.01", "-1", "4.205", "abc", "", "1e2"])
      expect(
        checkTerms({ kind: "loan", currency: "EUR", annualRate, monthlyPayment: "1" }),
        annualRate,
      ).toEqual({
        issues: [{ field: "annualRate", issue: "invalid" }],
      });
    for (const monthlyPayment of ["0", "0.00", "-5", "1.001", "1,5"])
      expect(
        checkTerms({ kind: "loan", currency: "EUR", annualRate: "0", monthlyPayment }),
        monthlyPayment,
      ).toEqual({ issues: [{ field: "monthlyPayment", issue: "invalid" }] });
    expect(parseAnnualRate("0")).toBe("0");
    expect(parseAnnualRate("100")).toBe("100");
    expect(parseAnnualRate("06.50")).toBe("6.5");
  });

  it("FIN-01@PoC FR 3: a loan has no grace period", () => {
    expect(
      checkTerms({
        kind: "loan",
        currency: "EUR",
        annualRate: "6",
        monthlyPayment: "650",
        gracePeriodDays: 30,
      }),
    ).toEqual({ issues: [{ field: "gracePeriodDays", issue: "not_allowed" }] });
  });
});

describe("FIN-01@PoC FR 16: a credit card has a credit limit and available funds", () => {
  it("FIN-01@PoC FR 3: limit and grace period are optional; a monthly payment is not a card's", () => {
    expect(checkTerms({ kind: "credit-card", currency: "EUR" })).toMatchObject({
      terms: { creditLimit: null, gracePeriodDays: null, monthlyPayment: null, annualRate: null },
    });
    expect(
      checkTerms({ kind: "credit-card", currency: "EUR", creditLimit: "5000", gracePeriodDays: 55 }),
    ).toMatchObject({ terms: { creditLimit: eur("5000"), gracePeriodDays: 55 } });
    expect(checkTerms({ kind: "credit-card", currency: "EUR", monthlyPayment: "10" })).toEqual({
      issues: [{ field: "monthlyPayment", issue: "not_allowed" }],
    });
    for (const gracePeriodDays of [-1, 366, 1.5])
      expect(checkTerms({ kind: "credit-card", currency: "EUR", gracePeriodDays })).toEqual({
        issues: [{ field: "gracePeriodDays", issue: "invalid" }],
      });
  });

  it("FIN-01@PoC AC8: a debt of 1 200 EUR on a limit of 5 000 EUR leaves 3 800 EUR available", () => {
    expect(availableCredit(eur("5000.00"), eur("1200.00")).toDecimalString()).toBe("3800");
  });

  it("FIN-01@PoC AC13: the available funds are exact Decimal money, never floats", () => {
    expect(availableCredit(eur("0.3"), eur("0.1")).toDecimalString()).toBe("0.2");
    expect(() => availableCredit(eur("1"), Money.of("1", "UAH"))).toThrow();
  });

  it("FIN-01@PoC FR 3: amounts have at most the currency's minor units", () => {
    expect(parseTypedAmount("10.00", "EUR")?.toDecimalString()).toBe("10");
    expect(parseTypedAmount("10.5", "JPY")).toBeNull();
    expect(parseTypedAmount("10", "JPY")?.currency).toBe("JPY");
    expect(parseTypedAmount("1", "HRK")).toBeNull();
  });
});
