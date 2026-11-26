import { describe, expect, it } from "vitest";
import { Money } from "@willowsum/domain-kernel";
import {
  goalContributions,
  incomeOf,
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

describe("BUD-03@PoC FR 2: the expected income of the month is the sum of «Надходження» (row 231)", () => {
  const salary = { id: "salary", groupId: "g-income", kind: "income" as const, state: "active" as const };
  const categories = new Map(
    [salary, { ...salary, id: "freelance" }].map((c) => [c.id, { ...c, mergedInto: null, essential: null }]),
  );
  const plan = {
    incomePlan: eur("5600"),
    incomePlans: [
      { categoryId: "salary", amount: eur("5000") },
      { categoryId: "freelance", amount: eur("600") },
    ],
    plannedSavings: eur("0"),
    limits: [],
  };
  const cell = (lineId: string | null, amount: string) => ({
    period: "2026-11",
    kind: "income" as const,
    lineId,
    amount: eur(amount),
    version: 1,
  });

  it("BUD-03@PoC FR 2, BUD-17@PoC FR 1: the plan of the month is the categories' rows — a month's own value of «Фриланс» 450,55 € makes it 5 450,55 €", () => {
    expect(incomeOf(plan, [], categories)).toEqual(eur("5600"));
    expect(incomeOf(plan, [cell("freelance", "450.55")], categories)).toEqual(eur("5450.55"));
    // Row 231: the «План доходу» typed before (nil line) is the month's plan, laid out on the rows; a regular income's
    // value no longer counts.
    expect(incomeOf(plan, [cell(null, "9000"), cell("payment", "7000")], categories)).toEqual(eur("9000"));
    // Once the month has an own value of a category, the typed amount is no longer read (it was stored on the rows).
    expect(incomeOf(plan, [cell(null, "9000"), cell("freelance", "450.55")], categories)).toEqual(
      eur("5450.55"),
    );
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
