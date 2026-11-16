import { Decimal, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  historyMonths,
  historyPeriods,
  incomeIrregular,
  monthHistory,
  proposeFromSpending,
  roundToTen,
  scalePlan,
  shareFrom,
  startChoices,
  type BudgetCategory,
  type MonthHistory,
} from "./index.ts";

/** BUD-02@PoC b) on the pure rules of the budget wizard: the start, the proportional period, the proposal. Synthetic data. */

const eur = (amount: string) => Money.of(amount, "EUR");
const uah = (amount: string) => Money.of(amount, "UAH");
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
const categories = new Map(
  [
    cat("groceries", "expense"),
    cat("cafes", "expense"),
    cat("hidden", "expense", { state: "hidden" }),
    cat("old", "expense", { state: "retired", mergedInto: "cafes" }),
    cat("salary", "income"),
    cat("transfer", "service"),
  ].map((c) => [c.id, c]),
);

/** A month of history: income and spending by category, all in EUR. */
const month = (period: string, income: string, spent: Record<string, string> = {}): MonthHistory => ({
  period,
  categorized: true,
  income: eur(income),
  spent: new Map(Object.entries(spent).map(([id, a]) => [id, eur(a)])),
});
const none = (period: string): MonthHistory => ({
  period,
  categorized: false,
  income: eur("0"),
  spent: new Map(),
});

describe("BUD-02@PoC: the start of the first period", () => {
  it("BUD-02@PoC AC15: on 18 November — «З 1 листопада», «З наступного місяця (1 грудня)», «Пропорційно на 18–30 листопада (13/30)», none chosen", () => {
    const { midPeriod, choices } = startChoices("2026-11-18");
    expect(midPeriod).toBe(true);
    expect(choices).toEqual([
      {
        start: "period-start",
        firstPeriod: "2026-11",
        from: "2026-11-01",
        to: "2026-11-30",
        days: null,
        daysInPeriod: null,
      },
      {
        start: "next-period",
        firstPeriod: "2026-12",
        from: "2026-12-01",
        to: "2026-12-31",
        days: null,
        daysInPeriod: null,
      },
      {
        start: "proportional",
        firstPeriod: "2026-11",
        from: "2026-11-18",
        to: "2026-11-30",
        days: 13,
        daysInPeriod: 30,
      },
    ]);
    // No period type and no default: a choice has no «selected» or «type» field.
    for (const c of choices)
      expect(Object.keys(c).sort()).toEqual(["days", "daysInPeriod", "firstPeriod", "from", "start", "to"]);
  });

  it("BUD-02@PoC FR 5: on the 1st of a month the first period is the current one — no mid-period block", () => {
    expect(startChoices("2026-12-01")).toEqual({
      midPeriod: false,
      choices: [
        {
          start: "period-start",
          firstPeriod: "2026-12",
          from: "2026-12-01",
          to: "2026-12-31",
          days: null,
          daysInPeriod: null,
        },
      ],
    });
  });

  it("BUD-02@PoC FR 14: the share is the days left, today included, of the days in the period — February too", () => {
    expect(shareFrom("2026-11-18")).toEqual({
      from: "2026-11-18",
      to: "2026-11-30",
      days: 13,
      daysInPeriod: 30,
    });
    expect(shareFrom("2028-02-29")).toEqual({
      from: "2028-02-29",
      to: "2028-02-29",
      days: 1,
      daysInPeriod: 29,
    });
    expect(shareFrom("2026-12-31")).toMatchObject({ days: 1, daysInPeriod: 31 });
  });

  it("BUD-02@PoC FR 14: a proportional first period multiplies the limits, the income plan and the planned savings by 13/30", () => {
    const scaled = scalePlan(
      {
        incomePlan: eur("3000"),
        plannedSavings: eur("300"),
        limits: [
          { categoryId: "groceries", amount: eur("600"), mandatory: true },
          { categoryId: "cafes", amount: eur("250"), mandatory: false },
        ],
      },
      shareFrom("2026-11-18"),
    );
    expect(scaled.incomePlan).toEqual(eur("1300"));
    expect(scaled.plannedSavings).toEqual(eur("130"));
    expect(scaled.limits).toEqual([
      { categoryId: "groceries", amount: eur("260"), mandatory: true },
      // 250 × 13 / 30 = 108.333… → 108.33 (half up to minor units; lead decision).
      { categoryId: "cafes", amount: eur("108.33"), mandatory: false },
    ]);
    // 100 × 13 / 30 = 43.333…; 5 × 1 / 30 = 0.1666… → 0.17: half up.
    expect(
      scalePlan({ incomePlan: eur("5"), plannedSavings: eur("0"), limits: [] }, shareFrom("2026-11-30"))
        .incomePlan,
    ).toEqual(eur("0.17"));
  });
});

describe("BUD-02@PoC: «Створити за моїми витратами»", () => {
  it("BUD-02@PoC FR 3: a limit is rounded to tens, a half up — in any reporting currency (UAH to 10 грн)", () => {
    expect(roundToTen(new Decimal("374.99"), "EUR")).toEqual(eur("370"));
    expect(roundToTen(new Decimal("375"), "EUR")).toEqual(eur("380"));
    expect(roundToTen(new Decimal("365"), "EUR")).toEqual(eur("370"));
    expect(roundToTen(new Decimal("4.99"), "EUR")).toEqual(eur("0"));
    expect(roundToTen(new Decimal("1234.5"), "UAH")).toEqual(uah("1230"));
    expect(roundToTen(new Decimal("1235"), "UAH")).toEqual(uah("1240"));
  });

  it("BUD-02@PoC AC1: limits = the 3-month average by category rounded to 10 €, the income plan = the average income", () => {
    const p = proposeFromSpending("EUR", [
      month("2026-10", "3000", { groceries: "610", cafes: "300.10" }),
      month("2026-09", "3100", { groceries: "580", cafes: "250" }),
      month("2026-08", "2950", { groceries: "596", cafes: "190" }),
      none("2026-07"),
      none("2026-06"),
      none("2026-05"),
    ]);
    expect(p).toMatchObject({ available: true, historyMonths: 3, incomeIrregular: false });
    // (3000 + 3100 + 2950) / 3 = 3016.666… → 3016.67.
    expect(p.incomePlan).toEqual(eur("3016.67"));
    expect(p.limits).toEqual([
      // (610 + 580 + 596) / 3 = 595.33 → 600.
      { categoryId: "groceries", average: eur("595.33"), limit: eur("600") },
      // (300.10 + 250 + 190) / 3 = 246.70 → 250.
      { categoryId: "cafes", average: eur("246.7"), limit: eur("250") },
    ]);
  });

  it("BUD-02@PoC FR 3: only the last 3 full months count; an average under 5 € proposes no limit (lead decision)", () => {
    const p = proposeFromSpending("EUR", [
      month("2026-10", "100", { groceries: "10", cafes: "3" }),
      month("2026-09", "100", { groceries: "20" }),
      month("2026-08", "100", { groceries: "30" }),
      month("2026-07", "100", { groceries: "9000" }),
      none("2026-06"),
      none("2026-05"),
    ]);
    expect(p.historyMonths).toBe(4);
    expect(p.limits).toEqual([
      { categoryId: "groceries", average: eur("20"), limit: eur("20") },
      { categoryId: "cafes", average: eur("1"), limit: null },
    ]);
  });

  it("BUD-02@PoC FR 2: «Створити за моїми витратами» needs 3 full months of categorized transactions without a gap", () => {
    const two = [
      month("2026-10", "1"),
      month("2026-09", "1"),
      none("2026-08"),
      month("2026-07", "1"),
      none("2026-06"),
      none("2026-05"),
    ];
    expect(historyMonths(two)).toBe(2);
    expect(proposeFromSpending("EUR", two)).toEqual({
      available: false,
      historyMonths: 2,
      incomePlan: null,
      incomeIrregular: false,
      limits: [],
    });
  });

  it("BUD-02@PoC EC2: without history only «Почати з нуля» — no proposal", () => {
    const p = proposeFromSpending("EUR", historyPeriods("2026-11-18").map(none));
    expect(p).toMatchObject({ available: false, historyMonths: 0, incomePlan: null, limits: [] });
  });

  it("BUD-02@PoC EC1: an irregular income (2 of 6 months off the 6-month average by more than 30 %) plans the lowest month", () => {
    // Average 2000; 1300 and 2700 are 35 % off; the plan is the lowest month, 1300.
    const irregular = ["2000", "1300", "2000", "2700", "2000", "2000"].map((i, n) =>
      month(`2026-${String(10 - n).padStart(2, "0")}`, i),
    );
    expect(incomeIrregular(irregular)).toBe(true);
    expect(proposeFromSpending("EUR", irregular)).toMatchObject({
      incomeIrregular: true,
      incomePlan: eur("1300"),
    });
    // One month off is regular: the 3-month average, (2000 + 1300 + 2000) / 3 = 1766.67.
    const regular = ["2000", "1300", "2000", "2000", "2000", "2000"].map((i, n) =>
      month(`2026-${String(10 - n).padStart(2, "0")}`, i),
    );
    expect(proposeFromSpending("EUR", regular)).toMatchObject({
      incomeIrregular: false,
      incomePlan: eur("1766.67"),
    });
    // Exactly 30 % off is not «more than 30 %».
    const edge = ["2000", "1400", "2000", "2600", "2000", "2000"].map((i, n) =>
      month(`2026-${String(10 - n).padStart(2, "0")}`, i),
    );
    expect(incomeIrregular(edge)).toBe(false);
  });

  it("BUD-02@PoC EC1: with fewer than 6 months of history the income counts as regular (lead decision)", () => {
    const five = [
      month("2026-10", "3000"),
      month("2026-09", "100"),
      month("2026-08", "3000"),
      month("2026-07", "9000"),
      month("2026-06", "3000"),
      none("2026-05"),
    ];
    expect(incomeIrregular(five)).toBe(false);
    expect(proposeFromSpending("EUR", five).incomePlan).toEqual(eur("2033.33"));
  });

  it("BUD-02@PoC FR 3: a month counts like a period — merged categories in their target, hidden and service ones and income out", () => {
    const m = monthHistory("2026-10", "EUR", categories, [
      { categoryId: "groceries", amount: eur("-100") },
      { categoryId: "groceries", amount: eur("20") },
      { categoryId: "old", amount: eur("-30") },
      { categoryId: "hidden", amount: eur("-40") },
      { categoryId: "transfer", amount: eur("-500") },
      { categoryId: null, amount: eur("-15") },
      { categoryId: "salary", amount: eur("2500") },
    ]);
    expect(m.categorized).toBe(true);
    expect(m.income).toEqual(eur("2500"));
    expect([...m.spent]).toEqual([
      ["groceries", eur("80")],
      ["cafes", eur("30")],
    ]);
    expect(
      monthHistory("2026-10", "EUR", categories, [{ categoryId: null, amount: eur("-15") }]).categorized,
    ).toBe(false);
  });
});
