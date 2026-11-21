import { describe, expect, it } from "vitest";
import { Money } from "@willowsum/domain-kernel";
import {
  goalContributions,
  incomeOf,
  incomePlanApproximate,
  mandatoryNeeds,
  plannedDebtExpenses,
  type LimitLine,
  type SpendableGoal,
} from "./index.ts";

/** BUD-03@PoC c): what the read of «Можна витратити» takes from «План» (the goals) and the mandatory categories. */
const eur = (amount: string) => Money.of(amount, "EUR");

const goal = (goalId: string, more: Partial<SpendableGoal> = {}): SpendableGoal => ({
  goalId,
  required: eur("334"),
  lastPeriod: "2027-08",
  contributed: eur("0"),
  ...more,
});
const cell = (kind: string, lineId: string | null, amount: string | null, period = "2026-11") => ({
  period,
  kind,
  lineId,
  amount: amount === null ? null : eur(amount),
});

describe("BUD-03@PoC FR 6: the goals' planned contributions of the month", () => {
  it("BUD-03@PoC FR 6: the month's cell of «План», else the required contribution up to the month of the date, else 0 — less what is contributed, never below 0", () => {
    const g = goalContributions(
      "2026-11",
      [
        goal("own", { contributed: eur("200") }),
        goal("required"),
        goal("no-date", { required: null, lastPeriod: null }),
        goal("past-date", { lastPeriod: "2026-10" }),
        goal("over", { contributed: eur("400") }),
      ],
      [
        cell("goal", "own", "500"),
        cell("goal", "required", null),
        cell("goal", "over", "300"),
        cell("goal", "own", "900", "2026-12"),
      ],
      "EUR",
    )!;
    expect(g.rows.map((r) => [r.goalId, r.planned.toDecimalString(), r.amount.toDecimalString()])).toEqual([
      ["own", "500", "300"],
      ["required", "334", "334"],
      ["no-date", "0", "0"],
      ["past-date", "0", "0"],
      ["over", "300", "0"],
    ]);
    expect(g.total).toEqual(eur("634"));
    // Business rules: what is contributed lowers the sum too — 200 + 0 + 0 + 0 + 400.
    expect(g.contributed).toEqual(eur("600"));
  });

  it("BUD-03@PoC FR 6: a contribution never raises the sum — «Цілі» = Σ max(planned, contributed)", () => {
    const of = (contributed: string) =>
      goalContributions(
        "2026-11",
        [goal("a", { contributed: eur(contributed) })],
        [cell("goal", "a", "500")],
        "EUR",
      )!;
    for (const [paid, holds] of [
      ["0", "500"],
      ["200", "500"],
      ["500", "500"],
      ["600", "600"],
    ] as const)
      expect(of(paid).total.plus(of(paid).contributed), paid).toEqual(eur(holds));
  });

  it("BUD-03@PoC FR 10: the planned savings — the goals' planned contributions and «Заощадження без цілі»", () => {
    const g = goalContributions(
      "2026-11",
      [goal("a", { contributed: eur("100") })],
      [cell("savings", null, "50")],
      "EUR",
    )!;
    expect(g.plannedSavings).toEqual(eur("384"));
    expect(g.total).toEqual(eur("234"));
  });

  it("BUD-03@PoC EC4: a goal without a figure (no rate) — no sum, never one without it; its own cell still counts", () => {
    expect(goalContributions("2026-11", [goal("a", { required: null })], [], "EUR")).toBeNull();
    expect(goalContributions("2026-11", [goal("a", { contributed: null })], [], "EUR")).toBeNull();
    // #641: a contribution without a rate leaves no sum even when nothing is planned for the goal (it lowers the sum).
    for (const unplanned of [{ required: null, lastPeriod: null }, { lastPeriod: "2026-10" }])
      expect(
        goalContributions("2026-11", [goal("a", { ...unplanned, contributed: null })], [], "EUR"),
      ).toBeNull();
    expect(
      goalContributions("2026-11", [goal("a", { contributed: null })], [cell("goal", "a", "0")], "EUR"),
    ).toBeNull();
    expect(
      goalContributions("2026-11", [goal("a", { required: null })], [cell("goal", "a", "10")], "EUR")!.total,
    ).toEqual(eur("10"));
  });
});

describe("BUD-03@PoC FR 8: «Обов'язкові категорії: ще потрібно N» by category", () => {
  const line = (categoryId: string, limit: string, spent: string, mandatory = true): LimitLine => ({
    categoryId,
    groupId: "g",
    mandatory,
    limit: eur(limit),
    spent: eur(spent),
    remaining: eur(limit).minus(eur(spent)),
  });

  it("BUD-03@PoC AC9: limit 620, spent 590 — ще потрібно 30; less the category's own unpaid payments; overspent and optional ones are left out", () => {
    expect(
      mandatoryNeeds(
        [
          line("groceries", "620", "590"),
          line("rent", "1000", "200"),
          line("utilities", "100", "150"),
          line("cafes", "300", "0", false),
        ],
        { recurring: [{ categoryId: "rent", amount: eur("700"), paid: false }], debtMinimums: [] },
        "EUR",
      ),
    ).toEqual([
      { categoryId: "groceries", amount: eur("30") },
      { categoryId: "rent", amount: eur("100") },
    ]);
  });
});

describe("BUD-03@PoC EC4: the month's income plan at the nearest rate (#651)", () => {
  const income = (paymentId: string, amount: string | null, approximate = false) => ({
    paymentId,
    amount: amount === null ? null : eur(amount),
    approximate,
  });
  const incomeCell = (lineId: string | null, amount: string) => ({
    period: "2026-11",
    kind: "income" as const,
    lineId,
    amount: eur(amount),
    version: 1,
  });

  it("BUD-03@PoC EC4: the regular incomes are the plan and one is at the nearest rate — «приблизно»", () => {
    const incomes = [income("a", "500.10", true), income("b", "299.90")];
    expect(incomePlanApproximate(incomeOf(eur("100"), [], incomes), [], incomes)).toBe(true);
  });

  it("BUD-03@PoC EC4: «План доходу» above the regular incomes, an income's own cell, or nothing at the nearest rate — exact", () => {
    const incomes = [income("a", "500.10", true)];
    expect(incomePlanApproximate(incomeOf(eur("900"), [], incomes), [], incomes)).toBe(false);
    const own = [incomeCell("a", "600")];
    expect(incomePlanApproximate(incomeOf(eur("100"), own, incomes), own, incomes)).toBe(false);
    const exact = [income("a", "500.10")];
    expect(incomePlanApproximate(incomeOf(eur("100"), [], exact), [], exact)).toBe(false);
    const none = [income("a", null, true)];
    expect(incomePlanApproximate(incomeOf(eur("0"), [], none), [], none)).toBe(false);
  });
});

describe("BUD-03@PoC FR 6: «Заплановані витрати» — a month's `debt` cell of «План» in place of the payoff plan's extra payment (#661)", () => {
  const cell = (lineId: string, amount: string | null, period = "2026-11") => ({
    period,
    kind: "debt",
    lineId,
    amount: amount === null ? null : eur(amount),
  });
  const plan = [
    { accountId: "a", amount: eur("100.00"), approximate: true },
    { accountId: "b", amount: eur("75.50"), approximate: false },
  ];
  const owed = new Set(["a", "b", "c"]);

  it("BUD-03@PoC FR 6: a cell above the plan's 100 € (250,25 €) or below it (40,10 €) replaces it — never added to it", () => {
    for (const [own, total] of [
      ["250.25", "325.75"],
      ["40.10", "115.60"],
      ["0", "75.50"],
    ] as const) {
      const r = plannedDebtExpenses("2026-11", plan, owed, [cell("a", own)], "EUR");
      expect(r.items).toEqual([
        { accountId: "a", amount: eur(own), approximate: false },
        { accountId: "b", amount: eur("75.50"), approximate: false },
      ]);
      expect(r.total).toEqual(eur(total));
      // The plan's amount at the nearest rate is no longer in the sum: not «приблизно».
      expect(r.approximate).toBe(false);
    }
  });

  it("BUD-03@PoC FR 6: no cell, an empty cell or another month's cell — the plan's extra payment, «приблизно» as read", () => {
    for (const cells of [[], [cell("a", null)], [cell("a", "999", "2026-12")]]) {
      const r = plannedDebtExpenses("2026-11", plan, owed, cells, "EUR");
      expect(r.total).toEqual(eur("175.50"));
      expect(r.approximate).toBe(true);
    }
  });

  it("BUD-03@PoC FR 6: only a `debt` cell replaces a debt's extra payment — a goal's or another kind's cell with the same line id does not", () => {
    for (const kind of ["goal", "savings"]) {
      const r = plannedDebtExpenses("2026-11", plan, owed, [{ ...cell("a", "999"), kind }], "EUR");
      expect(r.total).toEqual(eur("175.50"));
      expect(r.approximate).toBe(true);
    }
  });

  it("BUD-03@PoC FR 6: a debt the month owes without a plan's extra payment gets its cell; a debt it no longer owes does not come back", () => {
    const r = plannedDebtExpenses("2026-11", [], owed, [cell("c", "30.01"), cell("gone", "500")], "EUR");
    expect(r.items).toEqual([{ accountId: "c", amount: eur("30.01"), approximate: false }]);
    expect(r.total).toEqual(eur("30.01"));
  });
});
