import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  monthPlan,
  periodFigures,
  trendLine,
  trendPeriods,
  TREND_MONTHS_MAX,
  type BudgetCategory,
  type PeriodPlan,
} from "./index.ts";

/** BUD-16@PoC a) (wave 2 row 32) on the pure rules: the method «Ліміти» and the month's plan. Synthetic data. */

const eur = (amount: string) => Money.of(amount, "EUR");
const cat = (
  id: string,
  kind: BudgetCategory["kind"],
  extra: Partial<BudgetCategory> = {},
): BudgetCategory => ({
  id,
  groupId: `g-${kind}`,
  kind,
  state: "active",
  mergedInto: null,
  essential: kind === "expense" ? false : null,
  ...extra,
});
const categories = new Map(
  [
    cat("groceries", "expense", { essential: true }),
    cat("cafes", "expense"),
    cat("travel", "expense"),
    cat("salary", "income"),
    cat("old", "expense", { state: "retired", mergedInto: "cafes" }),
  ].map((c) => [c.id, c]),
);
const plan = (limits: Record<string, string>): PeriodPlan => ({
  incomePlan: eur("3000"),
  plannedSavings: eur("0"),
  limits: Object.entries(limits).map(([categoryId, amount]) => ({
    categoryId,
    amount: eur(amount),
    mandatory: false,
  })),
});

describe("BUD-16@PoC: «План місяця» under the method «Ліміти»", () => {
  it("BUD-16@PoC FR 4: the month's plan is the sum of the month's limits — Decimal, no float drift", () => {
    expect(monthPlan(plan({ groceries: "1800.10", cafes: "1999.95", travel: "999.95" }), "EUR")).toEqual(
      eur("4800"),
    );
    expect(monthPlan(plan({ groceries: "0.1", cafes: "0.2" }), "EUR")).toEqual(eur("0.3"));
  });

  it("BUD-16@PoC FR 4: a month without limits plans 0; a month before the budget has no plan (null)", () => {
    expect(monthPlan(plan({}), "EUR")).toEqual(eur("0"));
    expect(monthPlan(null, "EUR")).toBeNull();
  });

  it("BUD-16@PoC FR 4: filtered by a category — that category's limit; without one in that month — no plan (null)", () => {
    const p = plan({ groceries: "600", cafes: "200" });
    expect(monthPlan(p, "EUR", "groceries")).toEqual(eur("600"));
    expect(monthPlan(p, "EUR", "travel")).toBeNull();
  });

  it("BUD-16@PoC FR 2: no carry-over — each month's plan is that month's limits only, whatever was spent before", () => {
    const october = periodFigures(plan({ cafes: "200" }), categories, [
      { categoryId: "cafes", amount: eur("-350") },
    ]);
    expect(october.lines[0]!.remaining).toEqual(eur("-150"));
    // November's plan does not take October's −150 €.
    expect(monthPlan(plan({ cafes: "200" }), "EUR")).toEqual(eur("200"));
  });

  it("BUD-16@PoC FR 4: the trend's line of one month — plan, spending of every expense category (with «Поза планом» and «Без категорії») and income", () => {
    const figures = periodFigures(plan({ groceries: "500" }), categories, [
      { categoryId: "groceries", amount: eur("-420") },
      { categoryId: "travel", amount: eur("-150") },
      { categoryId: null, amount: eur("-30") },
      { categoryId: "old", amount: eur("-20") },
      { categoryId: "salary", amount: eur("2500") },
    ]);
    expect(trendLine(plan({ groceries: "500" }), figures, "EUR")).toEqual({
      plan: eur("500"),
      spent: eur("620"),
      income: eur("2500"),
    });
    // A merged category counts in the one it went to (BUD-01 FR 8).
    expect(trendLine(plan({ groceries: "500" }), figures, "EUR", "cafes").spent).toEqual(eur("20"));
    expect(trendLine(plan({ groceries: "500" }), figures, "EUR", "travel")).toEqual({
      plan: null,
      spent: eur("150"),
      income: eur("2500"),
    });
    expect(trendLine(plan({ groceries: "500" }), figures, "EUR", "groceries")).toMatchObject({
      plan: eur("500"),
      spent: eur("420"),
    });
  });

  it("BUD-16@PoC FR 4: a future month — the plan only, no fact", () => {
    const figures = periodFigures(plan({ groceries: "500" }), categories, null);
    expect(trendLine(plan({ groceries: "500" }), figures, "EUR")).toEqual({
      plan: eur("500"),
      spent: null,
      income: null,
    });
  });

  it("BUD-16@PoC FR 4: the trend's months — from and to inclusive, at most TREND_MONTHS_MAX; otherwise an issue", () => {
    expect(trendPeriods("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(trendPeriods("2026-02", "2026-02")).toEqual(["2026-02"]);
    expect(trendPeriods("2026-03", "2026-02")).toEqual({ field: "to", issue: "invalid" });
    expect(trendPeriods("2026-13", "2026-02")).toEqual({ field: "from", issue: "invalid" });
    expect(trendPeriods("2026-01", "2026-1")).toEqual({ field: "to", issue: "invalid" });
    expect(TREND_MONTHS_MAX).toBe(120);
    expect((trendPeriods("2016-12", "2026-11") as string[]).length).toBe(120);
    expect(trendPeriods("2016-11", "2026-11")).toEqual({ field: "from", issue: "too_many_months" });
  });
});
