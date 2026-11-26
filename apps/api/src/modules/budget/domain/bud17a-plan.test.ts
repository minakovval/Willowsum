import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  cellPeriodIssue,
  gridMonths,
  legacyIncome,
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
    // With income categories (row 231) the former «План доходу» is laid out on the rows; a regular income's value no
    // longer counts.
    const months = gridMonths(TODAY);
    const byCategory = planGrid(
      input({
        categories: [income("salary")],
        base: new Map(months.map((p) => [p, withIncome({ salary: "5000" })])),
        cells: [cell("2026-12", "income", null, "4000"), cell("2026-12", "income", "payment-1", "900")],
      }),
    );
    expect(byCategory.income.totals[1]).toEqual(eur("4000"));
    expect(byCategory.income.categories[0]!.cells[1]).toEqual({ amount: eur("4000"), own: true, version: 1 });
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

describe("BUD-17@PoC FR 1: the section's sum is the month's income plan", () => {
  it("BUD-17@PoC FR 1: «Надходження» adds up to the month's income plan also when an income category with a plan is hidden or merged", () => {
    const months = gridMonths(TODAY);
    const categories = [
      income("salary"),
      income("rent", { state: "hidden" }),
      income("old", { mergedInto: "salary" }),
    ];
    const base = withIncome({ salary: "5000", rent: "1000", old: "5" });
    const cells = [cell("2026-12", "income", "salary", "4000")];
    const g = planGrid(input({ categories, base: new Map(months.map((p) => [p, base])), cells }));
    const byId = new Map(categories.map((c) => [c.id, c]));
    for (const [i, period] of months.entries())
      expect(g.income.totals[i]).toEqual(
        withCells(
          base,
          cells.filter((c) => c.period === period),
          byId,
          lines(),
        ).incomePlan,
      );
    const allHidden = planGrid(
      input({
        categories: [income("salary", { state: "hidden" })],
        base: new Map(months.map((p) => [p, withIncome({ salary: "5000" })])),
      }),
    );
    expect(allHidden.income.categories).toEqual([]);
    expect(allHidden.income.totals[1]).toEqual(
      withCells(
        withIncome({ salary: "5000" }),
        [],
        new Map([["salary", income("salary", { state: "hidden" })]]),
        lines(),
      ).incomePlan,
    );
  });
});

describe("BUD-17@PoC FR 1 (lead decision 2026-11-26, row 231): the «План доходу» typed before is laid out on the rows", () => {
  const uah = (a: string) => Money.of(a, "UAH");
  const typed = (amount: string) => cell("2026-12", "income", null, amount, 3);
  const byId = (...cs: BudgetCategory[]) => new Map(cs.map((c) => [c.id, c]));
  const share = (r: ReturnType<typeof legacyIncome>) =>
    Object.fromEntries((r?.cells ?? []).map((c) => [c.lineId, c.amount!.toDecimalString()]));

  it("BUD-17@PoC FR 1: the shown categories in the budget's currency share it, largest plan first, the first also the excess — to the cent", () => {
    const plans = [
      { categoryId: "salary", amount: eur("3000") },
      { categoryId: "rent", amount: eur("1000") },
      { categoryId: "freelance", amount: eur("500.25") },
    ];
    const cs = byId(income("salary"), income("rent"), income("freelance"));
    expect(share(legacyIncome(plans, [typed("4099.57")], cs, "EUR"))).toEqual({
      salary: "3000",
      rent: "1000",
      freelance: "99.57",
    });
    expect(share(legacyIncome(plans, [typed("6000.01")], cs, "EUR"))).toEqual({
      salary: "4499.76",
      rent: "1000",
      freelance: "500.25",
    });
    expect(share(legacyIncome(plans, [typed("0")], cs, "EUR"))).toEqual({
      salary: "0",
      rent: "0",
      freelance: "0",
    });
    // Equal plans: by id.
    const tie = legacyIncome(
      [
        { categoryId: "b", amount: eur("100") },
        { categoryId: "a", amount: eur("100") },
      ],
      [typed("150")],
      byId(income("a"), income("b")),
      "EUR",
    );
    expect(tie?.cells.map((c) => [c.lineId, c.amount!.toDecimalString(), c.version])).toEqual([
      ["a", "100", 1],
      ["b", "50", 1],
    ]);
  });

  it("BUD-17@PoC FR 1: a hidden or merged planned category keeps its plan, the shown ones share the rest — the month is the typed amount", () => {
    const plans = [
      { categoryId: "salary", amount: eur("3000") },
      { categoryId: "rent", amount: eur("1000") },
      { categoryId: "old", amount: eur("5") },
    ];
    const cs = byId(
      income("salary"),
      income("rent", { state: "hidden" }),
      income("old", { mergedInto: "salary" }),
    );
    expect(share(legacyIncome(plans, [typed("3500")], cs, "EUR"))).toEqual({ salary: "2495" });
    const base = withIncome({ salary: "3000", rent: "1000", old: "5" });
    expect(withCells(base, [typed("3500")], cs, lines()).incomePlan).toEqual(eur("3500"));
    const months = gridMonths(TODAY);
    const g = planGrid(
      input({
        categories: [...cs.values()],
        base: new Map(months.map((p) => [p, base])),
        cells: [typed("3500")],
      }),
    );
    expect(g.income.categories.map((r) => r.cells[1])).toEqual([
      { amount: eur("2495"), own: true, version: 1 },
    ]);
    expect(g.income.totals.slice(0, 3)).toEqual([eur("4005"), eur("3500"), eur("4005")]);
    // The plans without a row above the typed amount, or no shown category in the budget's currency: the typed
    // amount is the month's plan as it is.
    expect(legacyIncome(plans, [typed("500")], cs, "EUR")).toEqual({ cells: [], typed: eur("500") });
    const onlyHidden = byId(income("salary", { state: "hidden" }), income("rent", { state: "hidden" }));
    expect(legacyIncome(plans, [typed("3500")], onlyHidden, "EUR")).toEqual({
      cells: [],
      typed: eur("3500"),
    });
    expect(withCells(base, [typed("500")], cs, lines()).incomePlan).toEqual(eur("500"));
  });

  it("BUD-17@PoC FR 1, business rules: a category in another currency gets no share and keeps its plan on top", () => {
    const plans = [
      { categoryId: "salary", amount: eur("1000") },
      { categoryId: "rent", amount: uah("20000") },
    ];
    const cs = byId(income("salary"), income("rent"));
    expect(share(legacyIncome(plans, [typed("1400")], cs, "EUR"))).toEqual({ salary: "1400" });
    // Only the rent in UAH: no category to share it — the typed amount stays.
    expect(legacyIncome([plans[1]!], [typed("1400")], cs, "EUR")).toEqual({ cells: [], typed: eur("1400") });
  });

  it("BUD-17@PoC FR 1: only the nil income cell is the typed «План доходу» — «Заощадження без цілі», a typed value in another currency, a month with an own value of a shown category take none", () => {
    const plans = [{ categoryId: "salary", amount: eur("3000") }];
    const cs = byId(income("salary"), income("rent", { state: "hidden" }));
    expect(legacyIncome(plans, [cell("2026-12", "savings", null, "4000")], cs, "EUR")).toBeNull();
    expect(legacyIncome(plans, [{ ...typed("4000"), amount: uah("4000") }], cs, "EUR")).toBeNull();
    expect(
      legacyIncome(plans, [typed("4000"), cell("2026-12", "income", "salary", "10")], cs, "EUR"),
    ).toBeNull();
    // A hidden category's own value does not stop it: it does not count.
    expect(
      share(legacyIncome(plans, [typed("4000"), cell("2026-12", "income", "rent", "10")], cs, "EUR")),
    ).toEqual({
      salary: "4000",
    });
    expect(legacyIncome([], [typed("4000")], cs, "EUR")).toBeNull();
  });
});
