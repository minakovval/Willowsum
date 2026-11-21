import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  incomeIrregular,
  incomeLines,
  proposeFromSpending,
  scalePlan,
  shareFrom,
  type BudgetCategory,
  type MonthHistory,
  type PeriodPlan,
} from "./index.ts";

/**
 * BUD-02@PoC FR 3, FR 9, FR 11, FR 21, EC1 (owner decision 2026-11-21, option 2 а): «План доходу» by income category —
 * the proposal of «Створити за моїми витратами», the per-category rule of an irregular income, the card «Дохід» and
 * the proportional first period. Pure rules; synthetic data.
 */
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
  essential: null,
  ...extra,
});
const categories = new Map(
  [
    cat("salary", "income"),
    cat("freelance", "income"),
    cat("rent", "income"),
    cat("bonuses", "income"),
    cat("old-income", "income", { state: "retired", mergedInto: "freelance" }),
    cat("hidden-income", "income", { state: "hidden" }),
    cat("groceries", "expense"),
  ].map((c) => [c.id, c]),
);

/** A full month with categorized history and the income of each category. */
const month = (period: string, income: Record<string, string>): MonthHistory => {
  const byCategory = new Map(Object.entries(income).map(([id, a]) => [id, eur(a)]));
  return {
    period,
    categorized: true,
    income: [...byCategory.values()].reduce((t, x) => t.plus(x), eur("0")),
    incomeByCategory: byCategory,
    spent: new Map(),
  };
};
const periods = ["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"];

describe("BUD-02@PoC FR 21: «План доходу» proposed by income category", () => {
  it("BUD-02@PoC AC18: «Зарплата» 5 000 € × 3 and «Дохід від оренди» 395, 405, 405 € → 5 000 € and 400 €, the income plan 5 400 €", () => {
    const p = proposeFromSpending("EUR", [
      month("2026-10", { salary: "5000", rent: "405" }),
      month("2026-09", { salary: "5000", rent: "405" }),
      month("2026-08", { salary: "5000", rent: "395" }),
    ]);
    expect(p.incomes).toEqual([
      { categoryId: "salary", average: eur("5000"), plan: eur("5000"), irregular: false },
      // (405 + 405 + 395) / 3 = 401.666… → 400; the field's hint 401.67.
      { categoryId: "rent", average: eur("401.67"), plan: eur("400"), irregular: false },
    ]);
    expect(p.incomePlan).toEqual(eur("5400"));
    expect(p.incomeIrregular).toBe(false);
  });

  it("BUD-02@PoC FR 3: a category's plan is its 3-month average to tens, an exact half to the even ten (405 → 400, 415 → 420)", () => {
    const p = proposeFromSpending("EUR", [
      month("2026-10", { salary: "405", rent: "415" }),
      month("2026-09", { salary: "405", rent: "415" }),
      month("2026-08", { salary: "405", rent: "415" }),
    ]);
    expect(p.incomes.map((i) => [i.categoryId, i.plan.toDecimalString()])).toEqual([
      ["rent", "420"],
      ["salary", "400"],
    ]);
    expect(p.incomePlan).toEqual(eur("820"));
  });

  it("BUD-02@PoC EC1: the irregular rule acts per income category — the salary keeps its 3-month average, an irregular freelance takes its lowest month of 6", () => {
    // Freelance: average 600 over 6 months; 200 and 1 000 are 67 % off — irregular, its plan the lowest month, 200.
    // The salary is the same every month — regular, its plan the 3-month average, not lowered by the freelance.
    const freelance = ["600", "200", "600", "1000", "600", "600"];
    const months = periods.map((p, i) => month(p, { salary: "3000", freelance: freelance[i]! }));
    expect(incomeIrregular(months, "freelance")).toBe(true);
    expect(incomeIrregular(months, "salary")).toBe(false);
    const p = proposeFromSpending("EUR", months);
    expect(p.incomes).toEqual([
      { categoryId: "salary", average: eur("3000"), plan: eur("3000"), irregular: false },
      { categoryId: "freelance", average: eur("466.67"), plan: eur("200"), irregular: true },
    ]);
    expect(p.incomePlan).toEqual(eur("3200"));
    expect(p.incomeIrregular).toBe(true);
  });

  it("BUD-02@PoC EC1: a category that comes not every month (bonuses) is irregular and gets plan 0; the lowest month is rounded to tens too", () => {
    const bonuses = ["500", "0", "0", "500", "0", "0"];
    const rent = ["404", "404", "404", "404", "404", "404"];
    const months = periods.map((p, i) =>
      month(p, { rent: rent[i]!, ...(bonuses[i] === "0" ? {} : { bonuses: bonuses[i]! }) }),
    );
    const p = proposeFromSpending("EUR", months);
    expect(p.incomes.map((i) => [i.categoryId, i.plan.toDecimalString(), i.irregular])).toEqual([
      ["rent", "400", false],
      ["bonuses", "0", true],
    ]);
  });

  it("BUD-02@PoC FR 21: the list holds the income categories with income in the 3 months, the largest plan first", () => {
    const p = proposeFromSpending("EUR", [
      month("2026-10", { rent: "100", salary: "1000" }),
      month("2026-09", { salary: "1000" }),
      month("2026-08", { salary: "1000" }),
      // Older than the 3 months: not listed.
      month("2026-07", { freelance: "900" }),
    ]);
    expect(p.incomes.map((i) => [i.categoryId, i.plan.toDecimalString()])).toEqual([
      ["salary", "1000"],
      // 100 / 3 = 33.33 → 30.
      ["rent", "30"],
    ]);
  });
});

const plan = (incomePlans: Record<string, string>): PeriodPlan => {
  const lines = Object.entries(incomePlans).map(([categoryId, a]) => ({ categoryId, amount: eur(a) }));
  return {
    incomePlan: lines.reduce((t, l) => t.plus(l.amount), eur("0")),
    incomePlans: lines,
    plannedSavings: eur("0"),
    limits: [],
  };
};

describe("BUD-02@PoC FR 9: the card «Дохід» — plan and fact by income category", () => {
  it("BUD-02@PoC FR 9: first the categories whose fact is below the plan, then those that reached it; income without a plan is a line with plan 0", () => {
    const lines = incomeLines(plan({ salary: "5000", rent: "400", freelance: "300" }), categories, [
      { categoryId: "salary", amount: eur("5000") },
      { categoryId: "rent", amount: eur("150") },
      // A merged category's income counts in the one it went to (BUD-01 FR 8).
      { categoryId: "old-income", amount: eur("120") },
      { categoryId: "bonuses", amount: eur("250") },
      { categoryId: "groceries", amount: eur("-80") },
    ]);
    expect(lines.map((l) => [l.categoryId, l.plan.toDecimalString(), l.actual?.toDecimalString()])).toEqual([
      ["rent", "400", "150"],
      ["freelance", "300", "120"],
      ["salary", "5000", "5000"],
      ["bonuses", "0", "250"],
    ]);
  });

  it("BUD-02@PoC FR 9: a future month has the plan's lines without a fact; a plan without categories has no lines", () => {
    expect(incomeLines(plan({ salary: "5000" }), categories, null)).toEqual([
      { categoryId: "salary", plan: eur("5000"), actual: null },
    ]);
    expect(
      incomeLines({ incomePlan: eur("3000"), plannedSavings: eur("0"), limits: [] }, categories, [
        { categoryId: "salary", amount: eur("0") },
      ]),
    ).toEqual([]);
  });
});

describe("BUD-02@PoC FR 21: the income plan is the sum of the categories' plans", () => {
  it("BUD-02@PoC FR 21: a proportional first period scales each category's plan and the income plan stays their sum", () => {
    // 13/30 of 1 000 = 433.333… → 433.33, of 500.05 = 216.688… → 216.69; the sum 650.02 (not 13/30 of 1 500.05).
    const scaled = scalePlan(plan({ salary: "1000", rent: "500.05" }), shareFrom("2026-11-18"));
    expect(scaled.incomePlans).toEqual([
      { categoryId: "salary", amount: eur("433.33") },
      { categoryId: "rent", amount: eur("216.69") },
    ]);
    expect(scaled.incomePlan).toEqual(eur("650.02"));
  });
});
