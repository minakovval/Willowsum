import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { termsAsKind, termsMissing } from "./index.ts";

/** FIN-12@PoC FR 5 on the liability's side: the terms after «Кредит» ↔ «Кредитна картка». */

describe("FIN-12@PoC FR 5, AC12: «Кредит» ↔ «Кредитна картка» terms", () => {
  const eur = (amount: string) => Money.of(amount, "EUR");
  const card = {
    kind: "credit-card" as const,
    currency: "EUR",
    annualRate: "36",
    monthlyPayment: null,
    creditLimit: eur("2000"),
    gracePeriodDays: 55,
  };

  it("FIN-12@PoC AC12: a card becomes a loan with its rate and limit, without a grace period or a payment — «Додайте ставку і платіж»", () => {
    const loan = termsAsKind(card, "loan");
    expect(loan).toEqual({ ...card, kind: "loan", gracePeriodDays: null });
    expect(termsMissing(loan)).toBe(true);
    expect(termsMissing({ kind: "loan", annualRate: "9.9", monthlyPayment: eur("310") })).toBe(false);
    expect(termsMissing({ kind: "loan", annualRate: null, monthlyPayment: eur("310") })).toBe(true);
    expect(termsMissing(card)).toBe(false);
  });

  it("FIN-12@PoC FR 5: a loan becomes a card without its monthly payment", () => {
    const loan = { ...card, kind: "loan" as const, monthlyPayment: eur("310"), gracePeriodDays: null };
    expect(termsAsKind(loan, "credit-card")).toEqual({ ...loan, kind: "credit-card", monthlyPayment: null });
  });
});
