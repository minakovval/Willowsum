import { describe, expect, it } from "vitest";
import { Money } from "@willowsum/domain-kernel";
import { goalContributions, mandatoryNeeds, type LimitLine, type SpendableGoal } from "./index.ts";

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
