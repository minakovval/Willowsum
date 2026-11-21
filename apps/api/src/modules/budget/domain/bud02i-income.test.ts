import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  incomeIrregular,
  incomeMonths,
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
    // Freelance: average 600 over 6 months; 1 000 and 200 are 67 % off — irregular, its plan the lowest month, 200.
    // The low month is older than the newest 3 (their average and lowest month are 600): the lowest of 6, not of 3.
    // The salary is the same every month — regular, its plan the 3-month average, not lowered by the freelance.
    const freelance = ["600", "600", "600", "1000", "200", "600"];
    const months = periods.map((p, i) => month(p, { salary: "3000", freelance: freelance[i]! }));
    expect(incomeIrregular(months, "freelance")).toBe(true);
    expect(incomeIrregular(months, "salary")).toBe(false);
    const p = proposeFromSpending("EUR", months);
    expect(p.incomes).toEqual([
      { categoryId: "salary", average: eur("3000"), plan: eur("3000"), irregular: false },
      { categoryId: "freelance", average: eur("600"), plan: eur("200"), irregular: true },
    ]);
    expect(p.incomePlan).toEqual(eur("3200"));
    expect(p.incomeIrregular).toBe(true);
  });

  it("BUD-02@PoC EC1: a category that comes not every month (bonuses) is irregular and gets plan 0; the lowest month is rounded to tens too", () => {
    // Its oldest income is 6 months back, so it has 6 full months of history.
    const bonuses = ["500", "0", "0", "500", "0", "500"];
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

  it("BUD-02@PoC EC1: a category with fewer than 6 full months of history is not irregular; its plan is the average of the months it has, up to 3 (lead decision 2026-11-21)", () => {
    // A new salary of 5 000 € for 3 months, nothing before: 6 months of the space's history, 3 of the category's.
    const salary = ["5000", "5000", "5000", "0", "0", "0"];
    // A side job of 2 months: (300 + 100) / 2 = 200, not / 3; 100 is 50 % off — still not irregular.
    const side = ["300", "100", "0", "0", "0", "0"];
    // 5 months of history with a low month older than the newest 3: regular, the 3-month average.
    const rent = ["400", "400", "400", "100", "400", "0"];
    const months = periods.map((p, i) =>
      month(
        p,
        Object.fromEntries(
          [
            ["salary", salary[i]!],
            ["freelance", side[i]!],
            ["rent", rent[i]!],
          ].filter(([, a]) => a !== "0"),
        ),
      ),
    );
    expect(["salary", "freelance", "rent"].map((id) => incomeMonths(months, id))).toEqual([3, 2, 5]);
    expect(["salary", "freelance", "rent"].map((id) => incomeIrregular(months, id))).toEqual([
      false,
      false,
      false,
    ]);
    const p = proposeFromSpending("EUR", months);
    expect(p.incomes).toEqual([
      { categoryId: "salary", average: eur("5000"), plan: eur("5000"), irregular: false },
      { categoryId: "rent", average: eur("400"), plan: eur("400"), irregular: false },
      { categoryId: "freelance", average: eur("200"), plan: eur("200"), irregular: false },
    ]);
    expect(p.incomePlan).toEqual(eur("5600"));
    expect(p.incomeIrregular).toBe(false);
    // The same salary once it has 6 months: 2 000 € for 3 months, then 5 000 € — irregular, the lowest month of 6.
    const raised = periods.map((p, i) => month(p, { salary: i < 3 ? "5000" : "2000" }));
    expect(incomeMonths(raised, "salary")).toBe(6);
    expect(proposeFromSpending("EUR", raised).incomes).toEqual([
      { categoryId: "salary", average: eur("5000"), plan: eur("2000"), irregular: true },
    ]);
  });

  it("BUD-02@PoC EC1: a quarterly bonus of 500, 0, 0, 500, 0, 0 € has gaps since its first income — irregular, plan 0 (lead decision 2026-11-21)", () => {
    // Newest month first: its first income in the window is 4 months back, so it has fewer than 6 months of history,
    // but it did not come every month since then — not a «new» category: irregular, its plan the lowest month of 6.
    const bonuses = ["500", "0", "0", "500", "0", "0"];
    const months = periods.map((p, i) =>
      month(p, { salary: "3000", ...(bonuses[i] === "0" ? {} : { bonuses: bonuses[i]! }) }),
    );
    expect(incomeMonths(months, "bonuses")).toBe(4);
    expect(incomeIrregular(months, "bonuses")).toBe(true);
    expect(incomeIrregular(months, "salary")).toBe(false);
    const p = proposeFromSpending("EUR", months);
    expect(p.incomes).toEqual([
      { categoryId: "salary", average: eur("3000"), plan: eur("3000"), irregular: false },
      // The hint is still its 3-month average: (500 + 0 + 0) / 3.
      { categoryId: "bonuses", average: eur("166.67"), plan: eur("0"), irregular: true },
    ]);
    expect(p.incomePlan).toEqual(eur("3000"));
    expect(p.incomeIrregular).toBe(true);
  });

  it("BUD-02@PoC EC1: a short history counts as «new» only with income in every month since its first one; one gap makes it irregular (lead decision 2026-11-21)", () => {
    // 3 months of history with a gap in the middle: irregular, plan 0 — the lowest month of 6.
    const gapped = ["300", "0", "300", "0", "0", "0"];
    // 3 months of history, income every month: «new», the average of the months it has.
    const steady = ["300", "200", "100", "0", "0", "0"];
    const months = periods.map((p, i) =>
      month(
        p,
        Object.fromEntries(
          [
            ["freelance", gapped[i]!],
            ["rent", steady[i]!],
          ].filter(([, a]) => a !== "0"),
        ),
      ),
    );
    expect(["freelance", "rent"].map((id) => incomeIrregular(months, id))).toEqual([true, false]);
    expect(proposeFromSpending("EUR", months).incomes).toEqual([
      { categoryId: "rent", average: eur("200"), plan: eur("200"), irregular: false },
      { categoryId: "freelance", average: eur("200"), plan: eur("0"), irregular: true },
    ]);
  });

  it("BUD-02@PoC EC1: with 6 full months one month without income is only 1 of 6 off by more than 30 % — not irregular, plan the 3-month average", () => {
    const v = ["1000", "1000", "0", "1000", "1000", "1000"];
    const months = periods.map((p, i) =>
      month(p, v[i] === "0" ? { salary: "1" } : { freelance: v[i]!, salary: "1" }),
    );
    expect(incomeIrregular(months, "freelance")).toBe(false);
    expect(proposeFromSpending("EUR", months).incomes.find((i) => i.categoryId === "freelance")).toEqual({
      categoryId: "freelance",
      average: eur("666.67"),
      plan: eur("670"),
      irregular: false,
    });
  });

  it("BUD-02@PoC FR 21: the list holds the income categories with income in the 3 months, the largest plan first", () => {
    const p = proposeFromSpending("EUR", [
      month("2026-10", { salary: "1000" }),
      month("2026-09", { salary: "1000" }),
      // Its oldest month with income is the third: 3 months of its history, with no income in the 2 after it — a gap,
      // so irregular (EC 1, lead decision 2026-11-21) and listed with plan 0.
      month("2026-08", { rent: "100", salary: "1000" }),
      // Older than the 3 months: not listed.
      month("2026-07", { freelance: "900" }),
    ]);
    expect(p.incomes.map((i) => [i.categoryId, i.plan.toDecimalString()])).toEqual([
      ["salary", "1000"],
      ["rent", "0"],
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
    // 13/30 of 30.15 = 13.065 → 13.06 (an exact half to even, not 13.07); the sum 26.12 — the total scaled, 13/30 of
    // 60.30 = 26.13, and half up, 26.14, both differ.
    const halves = scalePlan(plan({ salary: "30.15", rent: "30.15" }), shareFrom("2026-11-18"));
    expect(halves.incomePlans?.map((l) => l.amount)).toEqual([eur("13.06"), eur("13.06")]);
    expect(halves.incomePlan).toEqual(eur("26.12"));
  });
});

describe("sec702: EC 1 gaps — the newest month counts too (security review of #702)", () => {
  it("sec702: an income with no income in the newest full month only (0, 300, 300, 300) has a gap — irregular, plan 0", () => {
    const amounts = ["0", "300", "300", "300", "0", "0"];
    const months = periods.map((p, i) => month(p, amounts[i] === "0" ? {} : { freelance: amounts[i]! }));
    expect(incomeMonths(months, "freelance")).toBe(4);
    expect(incomeIrregular(months, "freelance")).toBe(true);
  });
});
