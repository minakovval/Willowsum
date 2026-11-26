import { Decimal, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  convertLines,
  gridMonths,
  planGrid,
  withCells,
  withPlanRates,
  type BudgetCategory,
  type GridInput,
  type PeriodPlan,
  type PlanCell,
  type PlanRates,
} from "./index.ts";

/**
 * #623 (follow-up of #626), redone for row 231 (BUD-17@PoC FR 1; owner decision 2026-11-21, 2 б): the month's income
 * plan is the sum of its income categories' rows — counted once, in the grid and in the period plan alike, exactly,
 * with categories of other currencies at today's rate. Synthetic amounts only; 1 € = 50,00 UAH.
 */
const eur = (a: string) => Money.of(a, "EUR");
const uah = (a: string) => Money.of(a, "UAH");
const TODAY = "2026-11-18";
const rates: PlanRates = new Map([
  ["UAH", { currency: "UAH", rate: new Decimal("0.02"), date: "2026-11-17", source: "NBU" }],
]);
const income = (id: string): BudgetCategory => ({
  id,
  groupId: "g-income",
  kind: "income",
  state: "active",
  mergedInto: null,
  essential: null,
});
const tree = [income("salary"), income("rent"), income("freelance")];
const shown = new Map(tree.map((c) => [c.id, c]));
/** «Зарплата» 5 000 €, «Дохід від оренди» 20 000 UAH (400 €), «Фриланс» 200,10 €. */
const plan = (): PeriodPlan => {
  const incomePlans = convertLines(
    [
      { categoryId: "salary", amount: eur("5000") },
      { categoryId: "rent", amount: uah("20000") },
      { categoryId: "freelance", amount: eur("200.10") },
    ],
    "EUR",
    rates,
  );
  return withPlanRates(
    {
      incomePlan: incomePlans.reduce((t, l) => t.plus(l.amount), eur("0")),
      incomePlans,
      plannedSavings: eur("0"),
      limits: [],
    },
    rates,
  );
};
const cell = (period: string, lineId: string, amount: Money): PlanCell => ({
  period,
  kind: "income",
  lineId,
  amount,
  version: 1,
});
function input(over: Partial<GridInput>): GridInput {
  const months = gridMonths(TODAY);
  return {
    today: TODAY,
    currency: "EUR",
    firstPeriod: "2026-11",
    categories: tree,
    base: new Map(months.map((p) => [p, plan()])),
    cells: [],
    goals: [],
    debts: new Map(months.map((p) => [p, []])),
    rates,
    ...over,
  };
}

describe("#623, row 231: the income categories' rows count once", () => {
  it("BUD-17@PoC FR 1: a row's cell is in its category's currency; the sum of the section is in the budget's at today's rate, named for «≈»", () => {
    const g = planGrid(input({ cells: [cell("2026-12", "rent", uah("25000.50"))] }));
    expect(g.income.categories.map((r) => r.cells[0]!.amount)).toEqual([
      eur("5000"),
      uah("20000"),
      eur("200.10"),
    ]);
    expect(g.income.categories[1]!.cells[1]).toEqual({ amount: uah("25000.50"), own: true, version: 1 });
    expect(g.income.totals[0]).toEqual(eur("5600.10"));
    // 25 000,50 UAH × 0,02 = 500,01 € — unrounded.
    expect(g.income.totals[1]).toEqual(eur("5700.11"));
    expect(g.rates).toEqual([...rates.values()]);
    // Without the rate: no sum, no «Не розподілено» — never a sum without the row.
    const none = planGrid(input({ rates: new Map() }));
    expect(none.income.totals[0]).toBeNull();
    expect(none.unallocated[0]).toBeNull();
  });

  it("BUD-17@PoC FR 1: in every month the income total = the sum of the rows = the period plan's income plan — no double count, to the cent", () => {
    const months = gridMonths(TODAY);
    const cases: Partial<Record<"salary" | "rent" | "freelance", Money>>[] = [
      {},
      { salary: eur("0") },
      { salary: eur("0.01"), freelance: eur("0") },
      { rent: uah("0.01") },
      { rent: uah("999999.99"), freelance: eur("0.03") },
      { salary: eur("999999999999.99"), rent: uah("1"), freelance: eur("0.01") },
      { salary: eur("5000"), rent: uah("20000"), freelance: eur("200.10") },
    ];
    for (const [k, c] of cases.entries()) {
      const p = months[k]!;
      const cells = Object.entries(c).map(([id, a]) => cell(p, id, a));
      const g = planGrid(input({ cells }));
      const total = g.income.totals[k]!;
      const label = JSON.stringify(c);
      const rows = g.income.categories.map((r) => r.cells[k]!.amount!);
      const sum = rows.reduce(
        (t, a) => t.plus(a.currency === "EUR" ? a : Money.of(a.amount.times("0.02").toString(), "EUR")),
        eur("0"),
      );
      expect(total.equals(sum), label).toBe(true);
      const period = withCells(plan(), cells, shown, { goalIds: new Set() }, rates);
      expect(period.incomePlan.equals(total), label).toBe(true);
      expect(
        period.incomePlans?.map((l) => (l.original ?? l.amount).toDecimalString()),
        label,
      ).toEqual(rows.map((a) => a.toDecimalString()));
      // «Не розподілено» takes the same total (no expenses, goals or debts here).
      expect(g.unallocated[k]?.kind, label).toBe("unallocated");
      expect(g.unallocated[k]!.amount.equals(total), label).toBe(true);
    }
  });

  it("BUD-02@PoC FR 9 (П-14): without own values (the flag `budget.plan` off) the month's plan is the categories' plans alone, to the cent", () => {
    expect(withCells(plan(), [], shown, { goalIds: new Set() }, rates).incomePlan).toEqual(eur("5600.10"));
  });
});
