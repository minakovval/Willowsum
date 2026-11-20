import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  gridMonths,
  planGrid,
  withCells,
  type BudgetCategory,
  type GridInput,
  type PeriodPlan,
  type PlanCell,
  type PlanIncome,
} from "./index.ts";

/**
 * #623 (follow-up of #626; from its security review) (BUD-17@PoC, owner decision 2026-11-19, Q3): the month's income plan counts «План доходу»
 * and the regular incomes once — never both — in the grid and in the period plan alike. Synthetic amounts only.
 */
const eur = (a: string) => Money.of(a, "EUR");
const TODAY = "2026-11-18";
const groceries: BudgetCategory = {
  id: "groceries",
  groupId: "g-home",
  kind: "expense",
  state: "active",
  mergedInto: null,
  essential: false,
};
const shown = new Map([["groceries", groceries]]);
const plan = (income: string): PeriodPlan => ({
  incomePlan: eur(income),
  plannedSavings: eur("0"),
  limits: [],
});
const cell = (period: string, lineId: string | null, amount: string): PlanCell => ({
  period,
  kind: "income",
  lineId,
  amount: eur(amount),
  version: 1,
});
function input(over: Partial<GridInput>): GridInput {
  const months = gridMonths(TODAY);
  return {
    today: TODAY,
    currency: "EUR",
    firstPeriod: "2026-11",
    categories: [groceries],
    base: new Map(months.map((p) => [p, plan("5600")])),
    cells: [],
    incomes: new Map(),
    goals: [],
    debts: new Map(months.map((p) => [p, []])),
    ...over,
  };
}

describe("#623: «План доходу», the regular incomes and «Інші надходження» count once", () => {
  it("BUD-17@PoC FR 1, FR 2 (owner decision 2026-11-19, Q3): a regular income's own month value counts in the period plan — over «План доходу» the plan is the regular incomes with it", () => {
    const salaries: PlanIncome[] = [
      { paymentId: "andrii", amount: eur("3100") },
      { paymentId: "olena", amount: eur("2500") },
    ];
    // 3 100 + 3 000.10 (typed for the month) = 6 100.10 > 5 600; without the cell it would be 5 600.
    const cells = [cell("2026-12", "olena", "3000.10")];
    const period = withCells(plan("5600"), cells, shown, { incomes: salaries, goalIds: new Set() });
    expect(period.incomePlan).toEqual(eur("6100.10"));
    const g = planGrid(input({ cells, incomes: new Map(gridMonths(TODAY).map((p) => [p, salaries])) }));
    expect(g.income.totals[1]).toEqual(eur("6100.10"));
    expect(g.income.other[1]).toBeNull();
    // A typed value under the expected amount lowers the regular incomes: the rest is «Інші надходження».
    const low = [cell("2026-12", "olena", "100.05")];
    expect(withCells(plan("5600"), low, shown, { incomes: salaries, goalIds: new Set() }).incomePlan).toEqual(
      eur("5600"),
    );
    const gl = planGrid(input({ cells: low, incomes: new Map(gridMonths(TODAY).map((p) => [p, salaries])) }));
    expect(gl.income.other[1]).toEqual(eur("2399.95"));
    expect(gl.income.totals[1]).toEqual(eur("5600"));
  });

  it("BUD-17@PoC FR 1 (owner decision 2026-11-19, Q3): in every month the income total = the regular incomes + «Інші надходження», is never under «План доходу», and equals the period plan — no double count", () => {
    const months = gridMonths(TODAY);
    const cases: { typed: string | null; regular: string[] }[] = [
      { typed: null, regular: [] },
      { typed: null, regular: ["0.01"] },
      { typed: null, regular: ["5599.99"] },
      { typed: null, regular: ["5600"] },
      { typed: null, regular: ["5600.01"] },
      { typed: "0", regular: ["0"] },
      { typed: "0", regular: ["12.34"] },
      { typed: "4000.50", regular: ["3100.25", "900.25"] },
      { typed: "4000.50", regular: ["3100.25", "900.24"] },
      { typed: "999999999999999.99", regular: ["0.01", "0.02"] },
      { typed: "0.03", regular: ["0.01", "0.01"] },
    ];
    for (const [k, c] of cases.entries()) {
      const p = months[k % months.length]!;
      const incomes: PlanIncome[] = c.regular.map((a, i) => ({ paymentId: `p${i}`, amount: eur(a) }));
      const cells = c.typed === null ? [] : [cell(p, null, c.typed)];
      const g = planGrid(input({ cells, incomes: new Map([[p, incomes]]) }));
      const i = months.indexOf(p);
      const regular = incomes.reduce((t, x) => t.plus(x.amount!), eur("0"));
      const typed = eur(c.typed ?? "5600");
      const total = g.income.totals[i]!;
      const other = g.income.other[i]!;
      const label = JSON.stringify(c);
      expect(g.income.plan[i]!.amount, label).toEqual(typed);
      expect(regular.plus(other ?? eur("0")), label).toEqual(total);
      expect(total.compare(typed) >= 0 && total.compare(regular) >= 0, label).toBe(true);
      expect(total.equals(typed) || total.equals(regular), label).toBe(true);
      if (other !== null) expect(other.isNegative() || other.isZero(), label).toBe(false);
      const period = withCells(plan("5600"), cells, shown, { incomes, goalIds: new Set() });
      expect(period.incomePlan, label).toEqual(total);
      // «Не розподілено» takes the same total (no expenses, goals or debts here).
      expect(g.unallocated[i], label).toEqual({ kind: "unallocated", amount: total });
    }
  });

  it("BUD-02@PoC FR 9 (П-14): without regular incomes (the flag `budget.plan` off) the month's plan is «План доходу» alone, to the cent", () => {
    const none = { incomes: [], goalIds: new Set<string>() };
    expect(withCells(plan("5600.07"), [], shown, none).incomePlan).toEqual(eur("5600.07"));
    // A stored value of a regular income does not count while its line is not read.
    expect(withCells(plan("5600.07"), [cell("2026-12", "olena", "9000")], shown, none).incomePlan).toEqual(
      eur("5600.07"),
    );
  });
});
