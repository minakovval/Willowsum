import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { assumptionsOf, simulateBase, withCardAmounts, type Debt, type StoredPlan } from "./payoff.ts";

const eur = (amount: string) => Money.of(amount, "EUR");

describe("BUD-19@PoC assumptions (#325 item 3)", () => {
  it("BUD-19@PoC EC6: an overpaid liability (a negative journal balance) is a zero balance, never a negative one", () => {
    const debt: Debt = {
      accountId: "a1",
      kind: "loan",
      name: "Synthetic loan",
      currency: "EUR",
      balance: eur("-12.50"),
      balanceLastMonth: eur("0"),
      startBalance: eur("100"),
      annualRate: "12",
      monthlyPayment: eur("50"),
    };
    const result = assumptionsOf(debt, {}, "2026-11");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.value.balance.toDecimalString()).toBe("0");
  });
});

describe("FLW-44@PoC: a credit card's «Зменшувати на … / міс.»", () => {
  const card: Debt = {
    accountId: "c1",
    kind: "credit-card",
    name: "Synthetic card",
    currency: "EUR",
    balance: eur("800"),
    balanceLastMonth: eur("800"),
    startBalance: eur("800"),
    annualRate: "24",
    monthlyPayment: null,
  };

  it("FLW-44@PoC FR 1: a card is calculated by its amount at no rate — the account's rate is not used; without the amount only the amount is asked", () => {
    const missing = assumptionsOf(card, {}, "2026-11");
    expect(missing).toEqual({ kind: "invalid", issues: [{ field: "monthlyPayment", issue: "required" }] });
    const given = assumptionsOf({ ...card, cardMonthlyAmount: eur("200") }, {}, "2026-11");
    expect(given.kind).toBe("ok");
    if (given.kind === "ok")
      expect([given.value.annualRate, given.value.monthlyPayment.toDecimalString()]).toEqual(["0", "200"]);
    const base = simulateBase({ ...card, cardMonthlyAmount: eur("200") });
    expect(base).toMatchObject({ kind: "paid", months: 4 });
    expect(simulateBase(card)).toBeNull();
  });

  it("FLW-44@PoC «Тлумачення ведучого»: the amount is the monthly payment of the card's saved plan; a loan gets none", () => {
    const plan = { accountId: "c1", currency: "EUR", monthlyPayment: eur("200") } as StoredPlan;
    const loan: Debt = { ...card, accountId: "l1", kind: "loan", monthlyPayment: eur("50") };
    const [c, l] = withCardAmounts([card, loan], [plan, { ...plan, accountId: "l1" }]);
    expect(c!.cardMonthlyAmount?.toDecimalString()).toBe("200");
    expect(l!.cardMonthlyAmount).toBeUndefined();
  });
});
