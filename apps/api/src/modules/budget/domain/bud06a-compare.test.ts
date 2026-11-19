import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  averageBase,
  baseWindow,
  BASES_BY_TYPE,
  categoryTotals,
  change,
  COMPARE_TYPES,
  compareSelection,
  compareTable,
  defaultBase,
  periodFigures,
  yearTable,
  type BudgetCategory,
  type CompareSelection,
  type PeriodPlan,
} from "./index.ts";

/** BUD-06@PoC a) (wave 2 row 36) on the pure rules: the windows, the bases and the figures of «Порівняння». Synthetic. */

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
  essential: kind === "expense" ? false : null,
  ...extra,
});
const list = [
  cat("groceries", "expense", { groupId: "g-home" }),
  cat("cafes", "expense", { groupId: "g-fun" }),
  cat("fuel", "expense", { groupId: "g-car" }),
  cat("gifts", "expense", { groupId: "g-fun" }),
  cat("travel", "expense", { groupId: "g-fun" }),
  cat("coffee", "expense", { state: "retired", mergedInto: "cafes" }),
  cat("salary", "income"),
  cat("transfer", "service"),
];
const categories = new Map(list.map((c) => [c.id, c]));
const plan = (limits: Record<string, string>, income = "3000"): PeriodPlan => ({
  incomePlan: eur(income),
  plannedSavings: eur("0"),
  limits: Object.entries(limits).map(([categoryId, amount]) => ({
    categoryId,
    amount: eur(amount),
    mandatory: false,
  })),
});
const sel = (input: Parameters<typeof compareSelection>[0], today: string) =>
  compareSelection(input, today) as CompareSelection;
const sums = (amounts: [string | null, string][]) =>
  categoryTotals(
    categories,
    amounts.map(([categoryId, amount]) => ({ categoryId, amount: eur(amount) })),
    "EUR",
  );

describe("BUD-06@PoC a): the windows of «Порівняння»", () => {
  it("BUD-06@PoC AC1 (server part): on the 12th of a month, «Попередній період» is days 1–12 of the previous month; «Повний попередній період» — all of it", () => {
    const s = sel({ type: "month", period: "2026-11" }, "2026-11-12");
    expect(s.window).toEqual({ from: "2026-11-01", to: "2026-11-12" });
    expect(s.inProgress).toBe(true);
    expect(baseWindow(s, "previous", false)).toEqual({ from: "2026-10-01", to: "2026-10-12" });
    expect(baseWindow(s, "previous", true)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("BUD-06@PoC FR 2: a finished month compares with the whole previous month", () => {
    const s = sel({ type: "month", period: "2026-04" }, "2026-11-12");
    expect(s).toMatchObject({
      window: { from: "2026-04-01", to: "2026-04-30" },
      inProgress: false,
      finished: true,
    });
    expect(baseWindow(s, "previous", false)).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("BUD-06@PoC AC6: on 31 March the base «Попередній період» is 1–28 February (1–29 in a leap year)", () => {
    expect(baseWindow(sel({ type: "month", period: "2026-03" }, "2026-03-31"), "previous", false)).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(baseWindow(sel({ type: "month", period: "2028-03" }, "2028-03-31"), "previous", false)).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("BUD-06@PoC FR 3: «та сама дата» is the day number; days 29–31 go to the last day of the shorter month", () => {
    expect(baseWindow(sel({ type: "month", period: "2026-03" }, "2026-03-30"), "previous", false).to).toBe(
      "2026-02-28",
    );
    expect(baseWindow(sel({ type: "month", period: "2026-05" }, "2026-05-30"), "previous", false).to).toBe(
      "2026-04-30",
    );
    expect(baseWindow(sel({ type: "month", period: "2026-07" }, "2026-07-31"), "previous", false).to).toBe(
      "2026-06-30",
    );
    // A leap day a year later: 29 February → 28 February.
    expect(baseWindow(sel({ type: "month", period: "2028-02" }, "2028-02-29"), "last-year", false)).toEqual({
      from: "2027-02-01",
      to: "2027-02-28",
    });
  });

  it("BUD-06@PoC EC1: months of different length — the same day number, 29–31 → the last day of the shorter month", () => {
    // A quarter in progress: the same day of the same month of the previous quarter.
    const q = sel({ type: "quarter", period: "2026-Q2" }, "2026-05-31");
    expect(q.window).toEqual({ from: "2026-04-01", to: "2026-05-31" });
    expect(baseWindow(q, "previous", false)).toEqual({ from: "2026-01-01", to: "2026-02-28" });
    expect(baseWindow(q, "previous", true)).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });

  it("BUD-06@PoC AC10 (server part): «З початку року» is January to today; its default base is «Той самий період минулого року»", () => {
    const s = sel({ type: "ytd" }, "2026-10-12");
    expect(s.window).toEqual({ from: "2026-01-01", to: "2026-10-12" });
    expect(s.months).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(defaultBase("ytd")).toBe("last-year");
    expect(BASES_BY_TYPE.ytd).toEqual(["last-year"]);
    expect(baseWindow(s, "last-year", false)).toEqual({ from: "2025-01-01", to: "2025-10-12" });
  });

  it("BUD-06@PoC FR 1: the bases of each type — «Рік» only «Минулий рік», «З початку року» only the same period last year", () => {
    expect(BASES_BY_TYPE.month).toEqual(["previous", "last-year", "avg3", "avg6", "avg12"]);
    expect(BASES_BY_TYPE.quarter).toEqual(["previous", "last-year", "avg3", "avg6", "avg12"]);
    expect(BASES_BY_TYPE.year).toEqual(["last-year"]);
    expect(defaultBase("month")).toBe("previous");
    expect(defaultBase("year")).toBe("last-year");
    const y = sel({ type: "year", period: "2025" }, "2026-11-12");
    expect(y.window).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(baseWindow(y, "last-year", false)).toEqual({ from: "2024-01-01", to: "2024-12-31" });
    // «Власний» is MVP (owner decision 2026-11-19, #606): no such type in this release.
    expect(COMPARE_TYPES).toEqual(["month", "quarter", "ytd", "year"]);
  });

  it("BUD-06@PoC FR 1: a period that is not a period of its type, or has not begun, is an issue", () => {
    const today = "2026-11-12";
    expect(compareSelection({ type: "month", period: "2026-13" }, today)).toEqual({
      field: "period",
      issue: "invalid",
    });
    expect(compareSelection({ type: "month", period: "2026-12" }, today)).toEqual({
      field: "period",
      issue: "future",
    });
    expect(compareSelection({ type: "quarter", period: "2026-Q5" }, today)).toEqual({
      field: "period",
      issue: "invalid",
    });
    expect(compareSelection({ type: "year", period: "26" }, today)).toEqual({
      field: "period",
      issue: "invalid",
    });
    // A past year's «З початку року» is a period (owner decision 2026-11-19, #609); one not begun is not.
    expect(compareSelection({ type: "ytd", period: "2027" }, today)).toEqual({
      field: "period",
      issue: "future",
    });
    expect(compareSelection({ type: "month", period: "0000-01" }, today)).toEqual({
      field: "period",
      issue: "invalid",
    });
  });

  it("BUD-06@PoC FR 4: «Середнє за 6 міс.» — the six finished months before the period, with a history of 13+ months", () => {
    const s = sel({ type: "month", period: "2026-11" }, "2026-11-12");
    expect(averageBase(s, 6, "2025-08-03", null)).toEqual({
      window: { from: "2026-05-01", to: "2026-10-31" },
      periods: 6,
      months: 6,
      included: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"],
    });
  });

  it("BUD-06@PoC FR 4: a finished month without data (no statement imported) is not one of the average's periods — «за 9 міс.»", () => {
    const s = sel({ type: "month", period: "2026-11" }, "2026-11-12");
    const withData = new Set([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    const a = averageBase(s, 12, "2025-12-28", withData);
    expect(a).toMatchObject({ window: { from: "2026-01-01", to: "2026-10-31" }, periods: 9, months: 9 });
    expect(a.included).not.toContain("2026-04");
    // A quarter has data when one of its months has.
    const q = sel({ type: "quarter", period: "2026-Q4" }, "2026-11-12");
    expect(averageBase(q, 6, "2026-01-01", new Set(["2026-04"]))).toMatchObject({ periods: 1, months: 3 });
    expect(averageBase(q, 6, "2026-01-01", new Set<string>())).toMatchObject({ window: null, periods: 0 });
  });

  it("BUD-06@PoC AC5 (server part): 90 days of history — the average counts the whole finished months there are, «за 2 міс.»", () => {
    const s = sel({ type: "month", period: "2026-11" }, "2026-11-12");
    // 90 days before 12 November: 14 August — August is not a whole month of data.
    expect(averageBase(s, 6, "2026-08-14", new Set(["2026-08", "2026-09", "2026-10"]))).toEqual({
      window: { from: "2026-09-01", to: "2026-10-31" },
      periods: 2,
      months: 2,
      included: ["2026-09", "2026-10"],
    });
    expect(averageBase(s, 3, "2026-11-02", null)).toEqual({
      window: null,
      periods: 0,
      months: 0,
      included: [],
    });
    expect(averageBase(s, 3, null, null)).toEqual({ window: null, periods: 0, months: 0, included: [] });
  });

  it("BUD-06@PoC FR 4: the average of a quarter is over the finished quarters of the last 3 / 6 / 12 months", () => {
    const q = sel({ type: "quarter", period: "2026-Q4" }, "2026-11-12");
    expect(averageBase(q, 12, "2025-01-01", null)).toMatchObject({
      window: { from: "2025-10-01", to: "2026-09-30" },
      periods: 4,
      months: 12,
    });
    expect(averageBase(q, 6, "2026-04-02", null)).toMatchObject({
      window: { from: "2026-07-01", to: "2026-09-30" },
      periods: 1,
      months: 3,
    });
  });
});

describe("BUD-06@PoC a): one change — amount, percent, direction and colour", () => {
  it("BUD-06@PoC AC15: «▲ 36,42 € · 5,2 %» light red, «▲ 240,00 € · 92,8 %» saturated red, «▼ 11,83 € · 6,6 %» light green", () => {
    expect(change(eur("742.30"), eur("705.88"), "expense")).toEqual({
      amount: eur("36.42"),
      percent: "5.2",
      direction: "up",
      tone: "loss-soft",
    });
    expect(change(eur("498.60"), eur("258.60"), "expense")).toEqual({
      amount: eur("240"),
      percent: "92.8",
      direction: "up",
      tone: "loss",
    });
    expect(change(eur("168.40"), eur("180.23"), "expense")).toEqual({
      amount: eur("-11.83"),
      percent: "6.6",
      direction: "down",
      tone: "gain-soft",
    });
  });

  it("BUD-06@PoC FR 1: «краще» or «гірше», not the direction — more income is green; 10 % inclusive is the light step", () => {
    expect(change(eur("1100"), eur("1000"), "income")).toMatchObject({ direction: "up", tone: "gain-soft" });
    expect(change(eur("1101"), eur("1000"), "income")).toMatchObject({ tone: "gain" });
    expect(change(eur("880"), eur("1000"), "income")).toMatchObject({ direction: "down", tone: "loss" });
    expect(change(eur("110"), eur("100"), "expense")).toMatchObject({ percent: "10.0", tone: "loss-soft" });
    expect(change(eur("110.01"), eur("100"), "expense")).toMatchObject({ tone: "loss" });
  });

  it("BUD-06@PoC FR 1: «без змін» — under 1 % and under 1 unit of the currency: no direction", () => {
    expect(change(eur("1000.90"), eur("1000"), "expense")).toEqual({
      amount: eur("0.9"),
      percent: "0.1",
      direction: "none",
      tone: "none",
    });
    // Under 1 unit but over 1 %: a change.
    expect(change(eur("50.90"), eur("50"), "expense")).toMatchObject({ direction: "up", tone: "loss-soft" });
    // Under 1 % but over 1 unit: a change.
    expect(change(eur("1005"), eur("1000"), "expense")).toMatchObject({ direction: "up", tone: "loss-soft" });
  });

  it("BUD-06@PoC AC7: a zero base and 80 € now — «+80 €» without a percent", () => {
    expect(change(eur("80"), eur("0"), "expense")).toEqual({
      amount: eur("80"),
      percent: null,
      direction: "up",
      tone: "loss",
    });
    expect(change(eur("0"), eur("0"), "expense")).toEqual({
      amount: eur("0"),
      percent: null,
      direction: "none",
      tone: "none",
    });
  });

  it("BUD-06@PoC EC2: a category with a zero base — the difference in €, no %", () => {
    expect(change(eur("12.50"), eur("0"), "expense").percent).toBeNull();
  });

  it("BUD-06@PoC AC9: 248,60 € against a limit of 200 € — «▲ 48,60 €», saturated red (24,3 % over the plan)", () => {
    expect(change(eur("248.60"), eur("200"), "expense")).toEqual({
      amount: eur("48.6"),
      percent: "24.3",
      direction: "up",
      tone: "loss",
    });
  });
});

describe("BUD-06@PoC a): the table of categories", () => {
  it("BUD-06@PoC AC2 (server part): «Середнє за 6 міс.» — the base is the average, categories sorted by the absolute difference, the three largest changes with their transactions", () => {
    const current = sums([
      ["cafes", "-500"],
      ["cafes", "-100"],
      ["groceries", "-700"],
      ["fuel", "-100"],
      ["gifts", "-80"],
      ["travel", "-300"],
    ]);
    // Six months: cafes 360 € in all (60 €/month, 1 transaction a month on average), groceries 4 140 € (690/month)...
    const base = sums([
      ...Array.from({ length: 6 }, () => ["cafes", "-60"] as [string, string]),
      ["groceries", "-4140"],
      ["fuel", "-900"],
      ["travel", "-1800"],
    ]);
    const t = compareTable({ currency: "EUR", current, base: { sums: base, divisor: 6 }, plans: null });
    expect(t.expenses.categories.map((r) => r.categoryId)).toEqual([
      "cafes",
      "gifts",
      "fuel",
      "groceries",
      "travel",
    ]);
    const cafes = t.expenses.categories[0]!;
    expect(cafes).toMatchObject({
      current: eur("600"),
      base: eur("60"),
      difference: { amount: eur("540"), percent: "900.0", direction: "up", tone: "loss" },
      transactions: { current: 2, base: 1 },
      plan: null,
      planDifference: null,
    });
    expect(t.largest).toEqual([
      { categoryId: "cafes", difference: eur("540"), transactions: { current: 2, base: 1 } },
      { categoryId: "gifts", difference: eur("80"), transactions: { current: 1, base: 0 } },
      { categoryId: "fuel", difference: eur("-50"), transactions: { current: 1, base: 0 } },
    ]);
    // «Подорожі» did not change: 300 € against an average of 300 € — not one of the largest changes.
    expect(t.expenses.categories.at(-1)).toMatchObject({
      categoryId: "travel",
      difference: { direction: "none" },
    });
    expect(t.expenses.total).toMatchObject({ current: eur("1780"), base: eur("1200") });
  });

  it("BUD-06@PoC FR 6: at most three largest changes, by the absolute difference; ties by the amount now", () => {
    const t = compareTable({
      currency: "EUR",
      current: sums([
        ["cafes", "-50"],
        ["fuel", "-10"],
        ["gifts", "-120"],
        ["travel", "-200"],
        ["groceries", "-70"],
      ]),
      base: {
        sums: sums([
          ["cafes", "-10"],
          ["fuel", "-50"],
          ["gifts", "-80"],
          ["travel", "-200"],
          ["groceries", "-100"],
        ]),
        divisor: 1,
      },
      plans: null,
    });
    // cafes +40, fuel −40, gifts +40 (now 120 — first of the ties), groceries −30, travel 0.
    expect(t.expenses.categories.map((r) => r.categoryId)).toEqual([
      "gifts",
      "cafes",
      "fuel",
      "groceries",
      "travel",
    ]);
    expect(t.largest.map((l) => l.categoryId)).toEqual(["gifts", "cafes", "fuel"]);
  });

  it("BUD-06@PoC FR 4: an average is exact — a third of 100 € is not rounded to cents", () => {
    const t = compareTable({
      currency: "EUR",
      current: sums([["cafes", "-40"]]),
      base: { sums: sums([["cafes", "-100"]]), divisor: 3 },
      plans: null,
    });
    expect(t.expenses.categories[0]!.base!.amount.toFixed(4)).toBe("33.3333");
    expect(t.expenses.categories[0]!.difference!.percent).toBe("20.0");
  });

  it("BUD-06@PoC FR 1: «± до плану» compares the plan with the budget period's fact (a proportional first period from its first day); the base columns with the whole window", () => {
    const t = compareTable({
      currency: "EUR",
      current: sums([
        ["groceries", "-170"],
        ["groceries", "-120"],
      ]),
      base: { sums: sums([["groceries", "-200"]]), divisor: 1 },
      plans: [plan({ groceries: "130" })],
      planCurrent: sums([["groceries", "-120"]]),
    });
    expect(t.expenses.categories[0]).toMatchObject({
      current: eur("290"),
      plan: eur("130"),
      planDifference: { amount: eur("-10"), direction: "down", tone: "gain-soft" },
      difference: { amount: eur("90") },
    });
    expect(t.expenses.total.planDifference).toMatchObject({ amount: eur("-10") });
  });

  it("BUD-06@PoC AC9 (server part): the plan of a category is its limit by the snapshot; a category «Поза планом» has none («–»)", () => {
    const t = compareTable({
      currency: "EUR",
      current: sums([
        ["cafes", "-248.60"],
        ["travel", "-120"],
      ]),
      base: null,
      plans: [plan({ cafes: "200", groceries: "500" })],
    });
    const row = (id: string) => t.expenses.categories.find((r) => r.categoryId === id)!;
    expect(row("cafes")).toMatchObject({
      plan: eur("200"),
      planDifference: { amount: eur("48.6"), percent: "24.3", direction: "up", tone: "loss" },
      base: null,
      difference: null,
    });
    expect(row("travel")).toMatchObject({ plan: null, planDifference: null });
    // A limit without spending is in the table with its plan.
    expect(row("groceries")).toMatchObject({ current: eur("0"), plan: eur("500") });
    expect(t.expenses.total).toMatchObject({ current: eur("368.6"), plan: eur("700") });
    expect(t.income.total).toMatchObject({ current: eur("0"), plan: eur("3000") });
    expect(t.largest).toEqual([]);
  });

  it("BUD-06@PoC FR 1: the plan of several months is the sum of their plans; a month before the budget has none", () => {
    const t = compareTable({
      currency: "EUR",
      current: sums([["cafes", "-100"]]),
      base: null,
      plans: [null, plan({ cafes: "200" }, "1000"), plan({ cafes: "250", fuel: "50" }, "1200")],
    });
    expect(t.expenses.categories.find((r) => r.categoryId === "cafes")!.plan).toEqual(eur("450"));
    expect(t.expenses.categories.find((r) => r.categoryId === "fuel")!.plan).toEqual(eur("50"));
    expect(t.expenses.total.plan).toEqual(eur("500"));
    expect(t.income.total.plan).toEqual(eur("2200"));
    const before = compareTable({ currency: "EUR", current: sums([]), base: null, plans: [null] });
    expect(before.expenses.total.plan).toBeNull();
    expect(before.income.total.plan).toBeNull();
  });

  it("BUD-06@PoC AC8: a merged category counts in the one it went to in every period", () => {
    const t = compareTable({
      currency: "EUR",
      current: sums([
        ["coffee", "-30"],
        ["cafes", "-70"],
      ]),
      base: { sums: sums([["coffee", "-50"]]), divisor: 1 },
      plans: null,
    });
    expect(t.expenses.categories.map((r) => r.categoryId)).toEqual(["cafes"]);
    expect(t.expenses.categories[0]).toMatchObject({ current: eur("100"), base: eur("50") });
  });

  it("BUD-06@PoC EC3: a transfer between own accounts is neither spending nor income; a refund lowers its category", () => {
    const t = compareTable({
      currency: "EUR",
      current: sums([
        ["transfer", "-500"],
        ["transfer", "500"],
        ["groceries", "-100"],
        ["groceries", "25"],
        ["salary", "2000"],
        [null, "-10"],
        [null, "40"],
      ]),
      base: null,
      plans: null,
    });
    expect(t.expenses.categories.map((r) => [r.categoryId, r.current])).toEqual([
      ["groceries", eur("75")],
      [null, eur("10")],
    ]);
    expect(t.expenses.total.current).toEqual(eur("85"));
    expect(t.income.categories.map((r) => [r.categoryId, r.current])).toEqual([["salary", eur("2000")]]);
    expect(t.income.total.current).toEqual(eur("2000"));
  });

  it("BUD-06@PoC FR 1: the period's figures and the comparison count the same way (one tally of categories)", () => {
    const amounts = [
      { categoryId: "cafes", amount: eur("-100") },
      { categoryId: "coffee", amount: eur("-20") },
      { categoryId: null, amount: eur("-5") },
      { categoryId: "salary", amount: eur("900") },
    ];
    const figures = periodFigures(plan({ cafes: "200" }), categories, amounts);
    const t = compareTable({
      currency: "EUR",
      current: categoryTotals(categories, amounts, "EUR"),
      base: null,
      plans: [plan({ cafes: "200" })],
    });
    expect(t.expenses.total.current).toEqual(figures.totals.spent!.plus(figures.totals.outsidePlan!));
    expect(t.income.total.current).toEqual(figures.totals.incomeActual);
    expect(t.expenses.total.plan).toEqual(figures.totals.limits);
  });
});

describe("BUD-06@PoC a): «Рік: план і факт»", () => {
  const months = (today: string, year: string) =>
    Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).map((period) => ({
      period,
      mode: (period < today.slice(0, 7) ? "past" : period === today.slice(0, 7) ? "current" : "future") as
        "past" | "current" | "future",
    }));

  it("BUD-06@PoC AC11 (server part): a year in November — 12 months, December the plan only; «Разом за рік», «План», «Різниця» over the finished months; the row «Дохід»", () => {
    const m = months("2026-11-12", "2026").map((x) => ({
      ...x,
      plan: x.period < "2026-03" ? null : plan({ cafes: "200" }, "3000"),
      sums:
        x.mode === "future"
          ? null
          : sums([
              ["cafes", "-210"],
              ["travel", "-50"],
              ["salary", "3100"],
            ]),
    }));
    const y = yearTable({ currency: "EUR", months: m, categories: list });
    expect(y.income.cells).toHaveLength(12);
    expect(y.income.cells[11]).toEqual({ fact: null, plan: eur("3000"), difference: null });
    expect(y.income.cells[2]).toEqual({
      fact: eur("3100"),
      plan: eur("3000"),
      difference: { amount: eur("100"), percent: "3.3", direction: "up", tone: "gain-soft" },
    });
    expect(y.income.cells[0]).toEqual({ fact: eur("3100"), plan: null, difference: null });
    // Totals over the finished months, January to October.
    expect(y.income).toMatchObject({ total: eur("31000"), plan: eur("24000") });
    const cafes = y.groups.flatMap((g) => g.categories).find((c) => c.categoryId === "cafes")!;
    expect(cafes.cells[11]).toEqual({ fact: null, plan: eur("200"), difference: null });
    expect(cafes.cells[10]).toMatchObject({
      fact: eur("210"),
      plan: eur("200"),
      difference: { tone: "loss-soft" },
    });
    expect(cafes).toMatchObject({ total: eur("2100"), plan: eur("1600") });
    expect(cafes.difference).toMatchObject({ amount: eur("500"), tone: "loss" });
    const travel = y.groups.flatMap((g) => g.categories).find((c) => c.categoryId === "travel")!;
    expect(travel).toMatchObject({ total: eur("500"), plan: null, difference: null });
    expect(travel.cells[5]).toEqual({ fact: eur("50"), plan: null, difference: null });
    // The group «g-fun» holds both; «Усього витрат» — every category.
    expect(y.groups.find((g) => g.groupId === "g-fun")).toMatchObject({
      total: eur("2600"),
      plan: eur("1600"),
    });
    expect(y.expenses).toMatchObject({ total: eur("2600"), plan: eur("1600") });
    expect(y.expenses.cells[11]).toEqual({ fact: null, plan: eur("200"), difference: null });
  });

  it("BUD-06@PoC FR 11: rows follow the category tree; a category without fact or plan in the year is not a row", () => {
    const m = months("2026-11-12", "2026").map((x) => ({
      ...x,
      plan: plan({ fuel: "80" }),
      sums:
        x.mode === "future"
          ? null
          : sums([
              ["groceries", "-10"],
              [null, "-3"],
            ]),
    }));
    const y = yearTable({ currency: "EUR", months: m, categories: list });
    expect(y.groups.map((g) => [g.groupId, g.categories.map((c) => c.categoryId)])).toEqual([
      ["g-home", ["groceries"]],
      ["g-car", ["fuel"]],
      [null, [null]],
    ]);
  });
});
