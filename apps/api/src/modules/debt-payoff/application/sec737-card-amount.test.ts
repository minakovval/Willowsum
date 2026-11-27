import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { strategyOf, withCardAmounts, type Debt, type StoredPlan } from "./payoff.ts";

const eur = (amount: string) => Money.of(amount, "EUR");

const card: Debt = {
  accountId: "card-1",
  kind: "credit-card",
  name: "Synthetic card",
  currency: "EUR",
  balance: eur("800"),
  balanceLastMonth: eur("800"),
  startBalance: eur("800"),
  annualRate: "24",
  monthlyPayment: null,
};
const loan: Debt = {
  ...card,
  accountId: "loan-1",
  kind: "loan",
  annualRate: "18",
  balance: eur("5000"),
  monthlyPayment: eur("150"),
};
const planOf = (accountId: string, currency: string, amount: string) =>
  ({ accountId, currency, monthlyPayment: Money.of(amount, currency) }) as StoredPlan;

describe("Security review of PR #737 (FLW-44@PoC): the card's «Зменшувати на … / міс.»", () => {
  it("FLW-44@PoC FR 1: a card takes the amount of its own saved plan only, never another debt's plan listed before it", () => {
    const [c] = withCardAmounts([card], [planOf("loan-1", "EUR", "999"), planOf("card-1", "EUR", "200")]);
    expect(c!.cardMonthlyAmount?.toDecimalString()).toBe("200");
    const [none] = withCardAmounts([card], [planOf("loan-1", "EUR", "999")]);
    expect(none!.cardMonthlyAmount).toBeNull();
  });

  it("FLW-44@PoC «Граничні випадки»: a plan in another currency than the card gives no amount (no cross-currency payment)", () => {
    const [c] = withCardAmounts([card], [planOf("card-1", "USD", "200")]);
    expect(c!.cardMonthlyAmount).toBeNull();
  });

  it("FLW-44@PoC FR 4: in «Стратегія» a card whose account carries a rate still has none — no interest, after the rated loan in Avalanche", () => {
    const [c] = withCardAmounts([card], [planOf("card-1", "EUR", "200")]);
    const s = strategyOf([c!, loan], { total: eur("550"), debts: [] });
    expect(s.kind).toBe("ok");
    if (s.kind !== "ok" || s.value.avalanche.kind !== "paid") throw new Error("not paid");
    // At 24 % the card would take the rest first and close in 2 months; with no rate it gets only its 200 € — 4 months.
    expect(s.value.avalanche.closedIn.get("card-1")).toBe(4);
  });
});
