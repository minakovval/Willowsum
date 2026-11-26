import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  cellPeriodIssue,
  gridMonths,
  planGrid,
  withCells,
  type BudgetCategory,
  type GridInput,
  type PeriodPlan,
  type PlanCell,
  type PlanLines,
} from "./index.ts";

const eur = (a: string) => Money.of(a, "EUR");
const cat = (id: string, over: Partial<BudgetCategory> = {}): BudgetCategory => ({
  id,
  groupId: "g-home",
  kind: "expense",
  state: "active",
  mergedInto: null,
  essential: false,
  ...over,
});
const plan = (income: string, limits: Record<string, string>): PeriodPlan => ({
  incomePlan: eur(income),
  plannedSavings: eur("0"),
  limits: Object.entries(limits).map(([categoryId, a]) => ({ categoryId, amount: eur(a), mandatory: false })),
});
const cell = (
  period: string,
  kind: PlanCell["kind"],
  lineId: string | null,
  amount: string | null,
  version = 1,
): PlanCell => ({
  period,
  kind,
  lineId,
  amount: amount === null ? null : eur(amount),
  version,
});

const TODAY = "2026-11-18";
const shown = new Map([["groceries", cat("groceries")]]);
const lines = (goalIds: string[] = []): PlanLines => ({ goalIds: new Set(goalIds) });
/** BUD-02 FR 21: a plan with its income categories' plans; the income plan is their sum. */
const withIncome = (incomes: Record<string, string>, limits: Record<string, string> = {}): PeriodPlan => {
  const incomePlans = Object.entries(incomes).map(([categoryId, a]) => ({ categoryId, amount: eur(a) }));
  return {
    ...plan(incomePlans.reduce((t, l) => t.plus(l.amount), eur("0")).toDecimalString(), limits),
    incomePlans,
  };
};
const income = (id: string, over: Partial<BudgetCategory> = {}) =>
  cat(id, { kind: "income", groupId: "g-income", essential: null, ...over });
function input(over: Partial<GridInput> = {}): GridInput {
  const months = gridMonths(TODAY);
  return {
    today: TODAY,
    currency: "EUR",
    firstPeriod: "2026-11",
    categories: [cat("groceries"), cat("salary", { kind: "income", groupId: "g-income" })],
    base: new Map(months.map((p) => [p, plan("5600", { groceries: "4200" })])),
    cells: [],
    goals: [],
    debts: new Map(months.map((p) => [p, [{ accountId: "loan", minimum: eur("300"), extra: null }]])),
    ...over,
  };
}

describe("BUD-17@PoC a): the grid «План»", () => {
  it("BUD-17@PoC FR 1, FR 6: the months are the current one and the 11 next", () => {
    expect(gridMonths("2026-11-30")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
      "2027-05",
      "2027-06",
      "2027-07",
      "2027-08",
      "2027-09",
      "2027-10",
    ]);
  });

  it("BUD-17@PoC AC2, FR 2: a month's own limit acts on that month only", () => {
    const g = planGrid(input({ cells: [cell("2026-12", "limit", "groceries", "650")] }));
    const cells = g.expenses.groups[0]!.categories[0]!.cells;
    expect(cells[0]).toEqual({ amount: eur("4200"), own: false, version: 0 });
    expect(cells[1]).toEqual({ amount: eur("650"), own: true, version: 1 });
    expect(cells[2]!.amount).toEqual(eur("4200"));
    const december = withCells(
      plan("0", { groceries: "700" }),
      [cell("2026-12", "limit", "groceries", "650")],
      shown,
      lines(),
    );
    expect(december.limits).toEqual([{ categoryId: "groceries", amount: eur("650"), mandatory: false }]);
  });

  it("BUD-17@PoC AC3, FR 2: a past month is read only; past the grid too", () => {
    expect(cellPeriodIssue("2026-10", TODAY)).toBe("past");
    expect(cellPeriodIssue("2026-11", TODAY)).toBeNull();
    expect(cellPeriodIssue("2027-10", TODAY)).toBeNull();
    expect(cellPeriodIssue("2027-11", TODAY)).toBe("too_far");
  });

  it("BUD-17@PoC AC6: «Не розподілено 200 €»; at 4 600 € of expenses «Дефіцит 200 €»", () => {
    const savings = cell("2026-11", "savings", null, "900");
    expect(planGrid(input({ cells: [savings] })).unallocated[0]).toEqual({
      kind: "unallocated",
      amount: eur("200"),
    });
    const over = planGrid(input({ cells: [savings, cell("2026-11", "limit", "groceries", "4600")] }));
    expect(over.unallocated[0]).toEqual({ kind: "deficit", amount: eur("200") });
  });

  it("BUD-17@PoC AC7: the goal's planned contribution is the required one until its month; a cell replaces it", () => {
    const g = planGrid(
      input({
        goals: [{ goalId: "trip", required: eur("334"), lastPeriod: "2027-02" }],
        cells: [cell("2026-12", "goal", "trip", "200")],
      }),
    );
    const cells = g.goals.rows[0]!.cells;
    expect(cells.map((c) => c.amount?.toDecimalString() ?? null).slice(0, 5)).toEqual([
      "334",
      "200",
      "334",
      "334",
      null,
    ]);
    expect(g.goals.totals[1]).toEqual(eur("200"));
    const december = withCells(
      plan("0", {}),
      [cell("2026-12", "goal", "trip", "200")],
      shown,
      lines(["trip"]),
    );
    expect(december.plannedSavings).toEqual(eur("200"));
  });

  it("BUD-17@PoC FR 1: a goal without a rate leaves its months without a total; a month with its own value has one", () => {
    const g = planGrid(
      input({
        goals: [{ goalId: "trip", required: null, lastPeriod: "2026-12" }],
        cells: [cell("2026-12", "goal", "trip", "100")],
      }),
    );
    expect(g.goals.totals.slice(0, 3)).toEqual([null, eur("100"), eur("0")]);
    expect(g.unallocated[0]).toBeNull();
  });

  it("BUD-17@PoC FR 1 (owner decision 2026-11-21): «Надходження» — a row per income category of the budget's plan; «Зарплата» 5 000 € and «Фриланс» 600 € — 5 600 €", () => {
    const months = gridMonths(TODAY);
    const g = planGrid(
      input({
        categories: [cat("groceries"), income("salary"), income("freelance"), income("gifts")],
        base: new Map(
          months.map((p) => [p, withIncome({ freelance: "600", salary: "5000" }, { groceries: "4200" })]),
        ),
        cells: [cell("2027-01", "income", "freelance", "800.25")],
      }),
    );
    // The tree's order; «Подарунки» has no plan in the budget — no row. No «План доходу», no «Інші надходження».
    expect(g.income.categories.map((r) => r.categoryId)).toEqual(["salary", "freelance"]);
    expect(Object.keys(g.income)).toEqual(["categories", "totals"]);
    expect(g.income.categories[0]!.cells[0]).toEqual({ amount: eur("5000"), own: false, version: 0 });
    expect(g.income.categories[1]!.cells[2]).toEqual({ amount: eur("800.25"), own: true, version: 1 });
    expect(g.income.totals.slice(0, 4)).toEqual([eur("5600"), eur("5600"), eur("5800.25"), eur("5600")]);
    // 5 600 − 4 200 − 0 − 300.
    expect(g.unallocated[0]).toEqual({ kind: "unallocated", amount: eur("1100") });
    // The month's plan is the sum of the rows, and the category's own value is that month's plan of the category.
    const january = withCells(
      withIncome({ salary: "5000", freelance: "600" }),
      [cell("2027-01", "income", "freelance", "800.25")],
      new Map([income("salary"), income("freelance")].map((c) => [c.id, c])),
      lines(),
    );
    expect(january.incomePlan).toEqual(eur("5800.25"));
    expect(january.incomePlans).toEqual([
      { categoryId: "salary", amount: eur("5000") },
      { categoryId: "freelance", amount: eur("800.25") },
    ]);
  });

  it("BUD-17@PoC FR 1: a month's own value of 0 for a category is kept — the sum drops by its plan; a cleared cell is back to the plan", () => {
    const months = gridMonths(TODAY);
    const g = planGrid(
      input({
        categories: [income("salary"), income("freelance")],
        base: new Map(months.map((p) => [p, withIncome({ salary: "5000", freelance: "600" })])),
        cells: [cell("2026-12", "income", "freelance", "0"), cell("2027-01", "income", "freelance", null, 2)],
      }),
    );
    expect(g.income.categories[1]!.cells[1]).toEqual({ amount: eur("0"), own: true, version: 1 });
    expect(g.income.categories[1]!.cells[2]).toEqual({ amount: eur("600"), own: false, version: 2 });
    expect(g.income.totals.slice(0, 3)).toEqual([eur("5600"), eur("5000"), eur("5600")]);
  });

  it("BUD-17@PoC FR 1: a budget without income categories has no rows — the sum is its plan without categories; the month's own value typed before stays in it", () => {
    const g = planGrid(input({ cells: [cell("2026-12", "income", null, "4000")] }));
    expect(g.income.categories).toEqual([]);
    expect(g.income.totals.slice(0, 3)).toEqual([eur("5600"), eur("4000"), eur("5600")]);
    expect(
      withCells(plan("5600", {}), [cell("2026-12", "income", null, "4000")], shown, lines()).incomePlan,
    ).toEqual(eur("4000"));
    // With income categories the former «План доходу» and a regular income's value (row 231) no longer count.
    const months = gridMonths(TODAY);
    const byCategory = planGrid(
      input({
        categories: [income("salary")],
        base: new Map(months.map((p) => [p, withIncome({ salary: "5000" })])),
        cells: [cell("2026-12", "income", null, "4000"), cell("2026-12", "income", "payment-1", "900")],
      }),
    );
    expect(byCategory.income.totals[1]).toEqual(eur("5000"));
  });

  it("BUD-17@PoC EC2: a cell whose line the grid no longer shows stops counting — a closed goal, a hidden category, an income category hidden or out of the plan", () => {
    const hidden = new Map(
      [
        cat("groceries", { state: "hidden" }),
        income("salary", { state: "hidden" }),
        income("freelance"),
        income("gifts"),
      ].map((c) => [c.id, c]),
    );
    const december = withCells(
      withIncome({ salary: "900", freelance: "100" }, { groceries: "700" }),
      [
        cell("2026-12", "goal", "closed-goal", "200"),
        cell("2026-12", "income", "salary", "600"),
        cell("2026-12", "income", "gifts", "800"),
        cell("2026-12", "limit", "groceries", "650"),
        cell("2026-12", "savings", null, "50"),
      ],
      hidden,
      lines(),
    );
    expect(december.plannedSavings).toEqual(eur("50"));
    expect(december.incomePlan).toEqual(eur("1000"));
    expect(december.limits).toEqual([{ categoryId: "groceries", amount: eur("700"), mandatory: false }]);
    const months = gridMonths(TODAY);
    const g = planGrid(
      input({
        categories: [...hidden.values(), income("old", { mergedInto: "freelance" })],
        base: new Map(months.map((p) => [p, withIncome({ salary: "900", freelance: "100", old: "5" })])),
      }),
    );
    expect(g.income.categories.map((r) => r.categoryId)).toEqual(["freelance"]);
  });

  it("BUD-17@PoC FR 2: a cleared cell (amount null) is back to the default and keeps its version", () => {
    const g = planGrid(input({ cells: [cell("2026-12", "limit", "groceries", null, 3)] }));
    expect(g.expenses.groups[0]!.categories[0]!.cells[1]).toEqual({
      amount: eur("4200"),
      own: false,
      version: 3,
    });
  });

  it("BUD-17@PoC FR 1: months before the budget's first period plan nothing", () => {
    const g = planGrid(input({ firstPeriod: "2026-12" }));
    expect(g.months[0]).toEqual({ period: "2026-11", mode: "current", inBudget: false });
    expect(g.unallocated[0]).toBeNull();
    expect(g.unallocated[1]).toEqual({ kind: "unallocated", amount: eur("1100") });
  });

  it("BUD-17@PoC EC1: a new category is empty in every month", () => {
    const g = planGrid(input({ categories: [cat("groceries"), cat("pets")] }));
    expect(g.expenses.groups[0]!.categories[1]!.cells.every((c) => c.amount === null)).toBe(true);
  });

  it("BUD-17@PoC EC2: a hidden or merged category's row is gone from the grid", () => {
    const g = planGrid(
      input({
        categories: [
          cat("groceries", { state: "hidden" }),
          cat("old", { mergedInto: "groceries" }),
          cat("cafe"),
        ],
      }),
    );
    expect(g.expenses.groups.flatMap((x) => x.categories.map((c) => c.categoryId))).toEqual(["cafe"]);
  });
});
