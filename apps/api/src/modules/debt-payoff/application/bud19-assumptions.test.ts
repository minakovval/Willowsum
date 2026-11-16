import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { assumptionsOf, type Debt } from "./payoff.ts";

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
