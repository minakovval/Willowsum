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
      new Map(),
      "EUR",
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
    const december = withCells(plan("0", {}), [cell("2026-12", "goal", "trip", "200")], new Map(), "EUR");
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

  it("BUD-17@PoC FR 1: «Інші надходження» is the income plan; a source's cell adds to the month", () => {
    const g = planGrid(
      input({ cells: [cell("2026-12", "income", "salary", "400"), cell("2027-01", "income", null, "5000")] }),
    );
    expect(g.income.rows.map((r) => r.categoryId)).toEqual([null, "salary"]);
    expect(g.income.totals.slice(0, 3)).toEqual([eur("5600"), eur("6000"), eur("5000")]);
    const january = withCells(
      plan("5600", {}),
      [cell("2027-01", "income", null, "5000"), cell("2027-01", "income", "salary", "50")],
      new Map(),
      "EUR",
    );
    expect(january.incomePlan).toEqual(eur("5050"));
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
