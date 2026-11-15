import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { checkTermsChange, sameTerms, termsOn, type LiabilityTerms } from "./index.ts";

/**
 * FIN-12@PoC FR 4, AC10 on the liability's side (#244 item 7): «Реквізити» change a loan's rate and monthly payment and
 * a card's credit limit, and the new terms apply from the date of the change — the dated history of the terms.
 */
const eur = (amount: string) => Money.of(amount, "EUR");
const loan: LiabilityTerms = {
  kind: "loan",
  currency: "EUR",
  annualRate: "9.9",
  monthlyPayment: eur("310.00"),
  creditLimit: null,
  gracePeriodDays: null,
};
const card: LiabilityTerms = {
  kind: "credit-card",
  currency: "EUR",
  annualRate: "36",
  monthlyPayment: null,
  creditLimit: eur("2000"),
  gracePeriodDays: 55,
};

describe("FIN-12@PoC FR 4: the terms «Реквізити» change", () => {
  it("FIN-12@PoC AC10: a loan's rate 9.9 % becomes 8.5 %, its payment unchanged", () => {
    expect(checkTermsChange(loan, { annualRate: "8.5" })).toEqual({ terms: { ...loan, annualRate: "8.5" } });
    expect(checkTermsChange(loan, { monthlyPayment: "295.50" })).toEqual({
      terms: { ...loan, monthlyPayment: eur("295.5") },
    });
  });

  it("FIN-12@PoC FR 4: a card's credit limit changes or is cleared; its rate and grace period stay", () => {
    expect(checkTermsChange(card, { creditLimit: "3500.00" })).toEqual({
      terms: { ...card, creditLimit: eur("3500") },
    });
    expect(checkTermsChange(card, { creditLimit: null })).toEqual({ terms: { ...card, creditLimit: null } });
  });

  it("FIN-12@PoC FR 4: a term of another kind is refused, a loan's rate and payment cannot be cleared, values follow FIN-01", () => {
    expect(checkTermsChange(loan, { creditLimit: "100" })).toEqual({
      issues: [{ field: "creditLimit", issue: "not_allowed" }],
    });
    expect(checkTermsChange(card, { annualRate: "20", monthlyPayment: "10" })).toEqual({
      issues: [
        { field: "annualRate", issue: "not_allowed" },
        { field: "monthlyPayment", issue: "not_allowed" },
      ],
    });
    expect(checkTermsChange(loan, { annualRate: null, monthlyPayment: null })).toEqual({
      issues: [
        { field: "annualRate", issue: "required" },
        { field: "monthlyPayment", issue: "required" },
      ],
    });
    for (const change of [
      { annualRate: "100.01" },
      { annualRate: "8.555" },
      { monthlyPayment: "0" },
      { monthlyPayment: "1.005" },
      { monthlyPayment: "-5" },
    ])
      expect(checkTermsChange(loan, change)).toEqual({
        issues: [{ field: Object.keys(change)[0], issue: "invalid" }],
      });
    expect(checkTermsChange(card, { creditLimit: "1e3" })).toEqual({
      issues: [{ field: "creditLimit", issue: "invalid" }],
    });
  });

  it("FIN-12@PoC AC12: a loan still without its payment gets the rate first and stays marked until the payment comes", () => {
    const pending = { ...loan, annualRate: null, monthlyPayment: null };
    expect(checkTermsChange(pending, { annualRate: "8.5" })).toEqual({
      terms: { ...pending, annualRate: "8.5" },
    });
  });

  it("FIN-12@PoC FR 4: the same amounts in another notation are the same terms", () => {
    const changed = checkTermsChange(loan, { monthlyPayment: "310" });
    if (!("terms" in changed)) throw new Error("refused");
    expect(sameTerms(loan, changed.terms)).toBe(true);
    expect(sameTerms(loan, { ...loan, annualRate: "8.5" })).toBe(false);
    expect(sameTerms(card, { ...card, creditLimit: null })).toBe(false);
  });
});

describe("FIN-12@PoC AC10: the new terms apply from the date of the change", () => {
  const periods = [
    { validFrom: null, terms: loan },
    { validFrom: "2026-11-15", terms: { ...loan, annualRate: "8.5" } },
    { validFrom: "2026-11-15", terms: { ...loan, annualRate: "8.4" } },
    { validFrom: "2026-12-01", terms: { ...loan, annualRate: "8.4", monthlyPayment: eur("300") } },
  ];

  it("FIN-12@PoC AC10: 9.9 % before the day of the change, the new rate from that day on; the last change of a day wins", () => {
    expect(termsOn(periods, "2024-01-01")?.annualRate).toBe("9.9");
    expect(termsOn(periods, "2026-11-14")?.annualRate).toBe("9.9");
    expect(termsOn(periods, "2026-11-15")?.annualRate).toBe("8.4");
    expect(termsOn(periods, "2026-11-30")?.monthlyPayment).toEqual(eur("310"));
    expect(termsOn(periods, "2026-12-01")?.monthlyPayment).toEqual(eur("300"));
  });

  it("FIN-12@PoC AC10: a liability never changed has its terms since the registration on every date", () => {
    expect(termsOn([{ validFrom: null, terms: card }], "2001-01-01")).toBe(card);
    expect(termsOn([], "2026-11-15")).toBeNull();
  });
});
