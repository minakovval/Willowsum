import { Decimal, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  convertLines,
  inBudgetCurrency,
  incomeLines,
  parseCategoryAmount,
  periodFigures,
  planGrid,
  scalePlan,
  withCells,
  withPlanRates,
  type BudgetCategory,
  type PeriodPlan,
  type PlanRates,
} from "./index.ts";

/**
 * BUD-02@PoC FR 1, FR 24, AC21 («Валюта категорії»; owner decision 2026-11-26, Q3 а), BUD-03@PoC and BUD-17@PoC business
 * rules on the pure rules: a limit or an income category's plan in its own currency, the totals in the budget's at the
 * plan's rate, the line in the category's currency. Synthetic data; 1 € = 50,00 UAH (UAH → EUR 0.02).
 */

const eur = (amount: string) => Money.of(amount, "EUR");
const uah = (amount: string) => Money.of(amount, "UAH");
const rates: PlanRates = new Map([
  ["UAH", { currency: "UAH", rate: new Decimal("0.02"), date: "2026-11-17", source: "NBU" }],
]);
const cat = (id: string, kind: BudgetCategory["kind"]): BudgetCategory => ({
  id,
  groupId: `g-${kind}`,
  kind,
  state: "active",
  mergedInto: null,
  essential: kind === "expense" ? false : null,
});
const categories = new Map(
  [cat("clubs", "expense"), cat("groceries", "expense"), cat("salary", "income")].map((c) => [c.id, c]),
);

/** AC21: «Гуртки дітей» 2 000 UAH, the other limits 1 000 €. */
function ac21Plan(): PeriodPlan {
  return withPlanRates(
    {
      incomePlan: eur("0"),
      plannedSavings: eur("0"),
      limits: convertLines(
        [
          { categoryId: "clubs", amount: uah("2000") },
          { categoryId: "groceries", amount: eur("1000") },
        ],
        "EUR",
        rates,
      ).map((l) => ({ ...l, mandatory: false })),
    },
    rates,
  );
}

describe("BUD-02@PoC FR 24: the currency of a category", () => {
  it("BUD-02@PoC FR 24: a limit in another currency is converted at the plan's rate, unrounded; the budget's own stays as is", () => {
    expect(inBudgetCurrency(uah("2000"), "EUR", rates)).toEqual(eur("40"));
    expect(inBudgetCurrency(uah("0.01"), "EUR", rates)).toEqual(eur("0.0002"));
    expect(inBudgetCurrency(eur("12.34"), "EUR", rates)).toEqual(eur("12.34"));
    // No rate — no figure, never the amount as if it were in the budget's currency.
    expect(inBudgetCurrency(Money.of("10", "USD"), "EUR", rates)).toBeNull();
  });

  it("BUD-02@PoC FR 24: a limit may be typed in another currency with a rate today; without a rate or past its minor units — refused", () => {
    expect(parseCategoryAmount("limits.0.amount", { amount: "2000", currency: "UAH" }, "EUR", rates)).toEqual(
      uah("2000"),
    );
    expect(
      parseCategoryAmount("limits.0.amount", { amount: "15.50", currency: "EUR" }, "EUR", rates),
    ).toEqual(eur("15.50"));
    expect(parseCategoryAmount("limits.0.amount", { amount: "10", currency: "USD" }, "EUR", rates)).toEqual({
      field: "limits.0.amount.currency",
      issue: "currency",
    });
    expect(parseCategoryAmount("limits.0.amount", { amount: "10", currency: "ZZ" }, "EUR", rates)).toEqual({
      field: "limits.0.amount.currency",
      issue: "currency",
    });
    expect(
      parseCategoryAmount("limits.0.amount", { amount: "1.005", currency: "UAH" }, "EUR", rates),
    ).toEqual({
      field: "limits.0.amount",
      issue: "invalid",
    });
    // 15 integer digits after the conversion too (#565): a rate above 1 may push the amount past them.
    const big: PlanRates = new Map([
      ["EUR", { currency: "EUR", rate: new Decimal("50"), date: "2026-11-17", source: "NBU" }],
    ]);
    expect(
      parseCategoryAmount("limits.0.amount", { amount: "999999999999999", currency: "EUR" }, "UAH", big),
    ).toEqual({ field: "limits.0.amount", issue: "invalid" });
  });

  it("BUD-02@PoC AC21: the line shows limit, spent and what is left in UAH; the total of limits ≈ 1 040,00 € with the rate", () => {
    const plan = ac21Plan();
    expect(plan.rates).toEqual([...rates.values()]);
    const figures = periodFigures(
      plan,
      categories,
      // In the budget's currency: 800,00 UAH at the rate of its date (here 0.02).
      [{ categoryId: "clubs", amount: eur("-16") }],
      new Map([["UAH", [{ categoryId: "clubs", amount: uah("-800.00") }]]]),
    );
    const clubs = figures.lines.find((l) => l.categoryId === "clubs")!;
    expect(clubs.original).toEqual({ limit: uah("2000"), spent: uah("800.00"), remaining: uah("1200.00") });
    expect([clubs.limit, clubs.spent, clubs.remaining]).toEqual([eur("40"), eur("16"), eur("24")]);
    expect(figures.lines.find((l) => l.categoryId === "groceries")!.original).toBeUndefined();
    expect(figures.totals.limits).toEqual(eur("1040"));
    expect(figures.totals.spent).toEqual(eur("16"));
  });

  it("BUD-02@PoC FR 24: a currency without any rate counts 0 and is named; a plan all in the budget's currency has no rates («≈» off)", () => {
    const plan = withPlanRates(
      {
        incomePlan: eur("0"),
        plannedSavings: eur("0"),
        limits: convertLines([{ categoryId: "clubs", amount: uah("2000") }], "EUR", new Map()).map((l) => ({
          ...l,
          mandatory: false,
        })),
      },
      new Map(),
    );
    expect(plan.limits[0]).toMatchObject({ amount: eur("0"), original: uah("2000") });
    expect(plan.missingRates).toEqual(["UAH"]);
    expect(plan.rates).toBeUndefined();
    const plain = withPlanRates({ incomePlan: eur("0"), plannedSavings: eur("0"), limits: [] }, rates);
    expect(plain.rates).toBeUndefined();
    expect(plain.missingRates).toBeUndefined();
  });

  it("BUD-02@PoC FR 24: the card «Дохід» — the plan and the fact of an income category in its own currency", () => {
    const plan = withPlanRates(
      {
        incomePlan: eur("1000"),
        incomePlans: convertLines([{ categoryId: "salary", amount: uah("50000") }], "EUR", rates),
        plannedSavings: eur("0"),
        limits: [],
      },
      rates,
    );
    const [line] = incomeLines(
      plan,
      categories,
      [{ categoryId: "salary", amount: eur("600") }],
      new Map([["UAH", [{ categoryId: "salary", amount: uah("30000") }]]]),
    );
    expect(line).toEqual({
      categoryId: "salary",
      plan: eur("1000"),
      actual: eur("600"),
      original: { plan: uah("50000"), actual: uah("30000") },
    });
  });

  it("BUD-02@PoC FR 24, FR 14: a proportional first period scales a limit in its own currency too and keeps the rates", () => {
    const scaled = scalePlan(ac21Plan(), {
      from: "2026-11-16",
      to: "2026-11-30",
      days: 15,
      daysInPeriod: 30,
    });
    expect(scaled.limits[0]).toMatchObject({ amount: eur("20"), original: uah("1000") });
    expect(scaled.rates).toEqual([...rates.values()]);
  });
});

describe("BUD-17@PoC: a category's cell in its currency", () => {
  it("BUD-17@PoC business rules: a month's own value of a category is in its currency and converted into the month's plan", () => {
    const month = withCells(
      ac21Plan(),
      [{ period: "2026-12", kind: "limit", lineId: "clubs", amount: uah("2500"), version: 1 }],
      categories,
      null,
    );
    expect(month.limits.find((l) => l.categoryId === "clubs")).toMatchObject({
      amount: eur("50"),
      original: uah("2500"),
    });
    expect(month.rates).toEqual([...rates.values()]);
  });

  it("BUD-17@PoC business rules: the grid's cell of a category is in its currency; the sum of «Витрати» is in the budget's at today's rate, without a rate — no sum", () => {
    const tree = [...categories.values()];
    const base = new Map([["2026-11", ac21Plan()]]);
    const input = {
      today: "2026-11-18",
      currency: "EUR",
      firstPeriod: "2026-11",
      categories: tree,
      base,
      cells: [],
      incomes: new Map(),
      goals: [],
      debts: new Map(),
    };
    const grid = planGrid({ ...input, rates });
    const clubs = grid.expenses.groups[0]!.categories.find((c) => c.categoryId === "clubs")!;
    expect(clubs.cells[0]!.amount).toEqual(uah("2000"));
    expect(grid.expenses.totals[0]).toEqual(eur("1040"));
    expect(grid.rates).toEqual([...rates.values()]);
    const unknown = planGrid({ ...input, rates: new Map() });
    expect(unknown.expenses.totals[0]).toBeNull();
    expect(unknown.unallocated[0]).toBeNull();
  });
});
