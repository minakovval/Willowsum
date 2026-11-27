import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { categoryTotals, type BudgetCategory } from "./budget.ts";
import { monthHistory } from "./wizard.ts";

/**
 * FIN-03@PoC FR 8, AC31 (owner, 2026-11-26, decision 11; review of #728): a transfer's difference against the official
 * rate in «Комісії банку» — a loss is spending, a gain is income of the budget under the same category, never a refund.
 */
const FEES = "fees";
const categories = new Map<string, BudgetCategory>([
  [
    FEES,
    { id: FEES, groupId: "finance", kind: "expense", state: "active", mergedInto: null, essential: null },
  ],
]);
const uah = (a: string) => Money.of(a, "UAH");

describe("FIN-03@PoC FR 8: the budget counts a transfer's gain as income, its loss as spending", () => {
  it("FIN-03@PoC AC31: +30 UAH gain in «Комісії банку» — income 30, no spending of the category", () => {
    const t = categoryTotals(categories, [{ categoryId: FEES, amount: uah("30"), asIncome: true }], "UAH");
    expect(t.income.get(FEES)?.amount.toDecimalString()).toBe("30");
    expect(t.spent.get(FEES)).toBeUndefined();
  });

  it("FIN-03@PoC AC31: −30 UAH loss in «Комісії банку» — spending 30, no income", () => {
    const t = categoryTotals(categories, [{ categoryId: FEES, amount: uah("-30") }], "UAH");
    expect(t.spent.get(FEES)?.amount.toDecimalString()).toBe("30");
    expect(t.income.size).toBe(0);
  });

  it("FIN-03@PoC AC31: a gain in «Комісії банку» is the month's income but no income plan line of the wizard", () => {
    const m = monthHistory("2026-10", "UAH", categories, [
      { categoryId: FEES, amount: uah("30"), asIncome: true },
    ]);
    expect([m.income.toDecimalString(), m.incomeByCategory.size]).toEqual(["30", 0]);
  });
});
