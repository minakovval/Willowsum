import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  monthFigures,
  monthsOf,
  periodTotals,
  ratePercent,
  savingsRate,
  viewOf,
  type CashflowCategory,
  type CountedLine,
} from "./index.ts";

const eur = (a: string) => Money.of(a, "EUR");
const cats = new Map<string, CashflowCategory>([
  ["salary", { id: "salary", kind: "income", state: "active", mergedInto: null }],
  ["food", { id: "food", kind: "expense", state: "active", mergedInto: null }],
  ["old-food", { id: "old-food", kind: "expense", state: "retired", mergedInto: "food" }],
  ["old-salary", { id: "old-salary", kind: "income", state: "retired", mergedInto: "salary" }],
  ["transfer", { id: "transfer", kind: "service", state: "active", mergedInto: null }],
]);
const line = (month: string, categoryId: string | null, amount: string): CountedLine => ({
  month,
  categoryId,
  amount: eur(amount),
});

describe("BUD-08@PoC: period types and months", () => {
  it("BUD-08@PoC FR 1: month, quarter, year to date and year; «Власний» is not a type", () => {
    const today = "2026-11-19";
    expect(monthsOf("month", "2026-09", today)).toEqual(["2026-09"]);
    expect(monthsOf("quarter", "2026-Q3", today)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(monthsOf("ytd", "2026", today)).toHaveLength(11);
    expect(monthsOf("ytd", "2025", today)).toHaveLength(12);
    expect(monthsOf("year", "2026", today)).toEqual(
      Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`),
    );
    expect(viewOf("month")).toBe("month");
    for (const t of ["quarter", "ytd", "year"] as const) expect(viewOf(t)).toBe("monthly");
    expect(monthsOf("month", "2026-13", today)).toBeNull();
    expect(monthsOf("quarter", "2026-Q5", today)).toBeNull();
    expect(monthsOf("month", "2026-12", today)).toBeNull(); // after the current month
    expect(monthsOf("custom" as never, "2026", today)).toBeNull();
  });
});

describe("BUD-08@PoC: income, spending, net flow, savings rate", () => {
  it("BUD-08@PoC FR 3: net flow = income − spending; the rate in per cent with one digit, half to even", () => {
    const [m] = monthFigures(
      ["2026-09"],
      [line("2026-09", "salary", "6000"), line("2026-09", "food", "-4500")],
      cats,
      "EUR",
    );
    expect(m!.netFlow.equals(eur("1500"))).toBe(true);
    expect(ratePercent(m!.savingsRate)).toBe("25.0");
    // 1/3 = 33.333… → 33.3; 0.25 % and 0.35 % of half cases go to the even digit.
    expect(ratePercent(savingsRate(eur("300"), eur("200")))).toBe("33.3");
    expect(ratePercent(savingsRate(eur("4000"), eur("3999.99")))).toBe("0.0"); // 0.00025 % → 0.0
    expect(ratePercent(savingsRate(eur("2000"), eur("1999.5")))).toBe("0.0"); // 0.025 → 0.0
    expect(ratePercent(savingsRate(eur("2000"), eur("1997")))).toBe("0.2"); // 0.15 → 0.2 (even)
    expect(ratePercent(savingsRate(eur("2000"), eur("1995")))).toBe("0.2"); // 0.25 → 0.2 (even)
  });

  it("BUD-08@PoC AC3, EC1: no income — the rate is «–» (null), net flow −800 €", () => {
    const [m] = monthFigures(["2026-10"], [line("2026-10", "food", "-800")], cats, "EUR");
    expect(m!.savingsRate).toBeNull();
    expect(ratePercent(m!.savingsRate)).toBeNull();
    expect(m!.netFlow.equals(eur("-800"))).toBe(true);
    // Income below zero (a clawback larger than the inflows) is no income either: «–», not a rate.
    expect(savingsRate(eur("-50"), eur("800"))).toBeNull();
  });

  it("BUD-08@PoC FR 8: «Переказ» (service) is neither income nor spending; a merged category counts in its target", () => {
    const [m] = monthFigures(
      ["2026-09"],
      [
        line("2026-09", "transfer", "-1000"),
        line("2026-09", "transfer", "1000"),
        line("2026-09", "old-food", "-20"),
      ],
      cats,
      "EUR",
    );
    expect(m!.income.isZero()).toBe(true);
    expect(m!.expenses.equals(eur("20"))).toBe(true);
    // A merged income category still counts as income in its target, not as an uncategorized inflow (reviewer, #580).
    const [merged] = monthFigures(["2026-09"], [line("2026-09", "old-salary", "500")], cats, "EUR");
    expect(merged!.income.equals(eur("500"))).toBe(true);
    expect(merged!.uncategorizedInflows.count).toBe(0);
  });

  it("BUD-08@PoC FR 9: an uncategorized inflow lowers spending, not income, and is counted for the hint", () => {
    const [m] = monthFigures(
      ["2026-09"],
      [line("2026-09", "food", "-100"), line("2026-09", null, "30"), line("2026-09", null, "-10")],
      cats,
      "EUR",
    );
    expect(m!.income.isZero()).toBe(true);
    expect(m!.expenses.equals(eur("80"))).toBe(true);
    expect(m!.uncategorizedInflows.count).toBe(1);
    expect(m!.uncategorizedInflows.amount.equals(eur("30"))).toBe(true);
  });

  it("BUD-08@PoC FR 11, AC6: the period's rate is over the sums; the mean of monthly rates is over months with income", () => {
    const months = monthFigures(
      ["2026-07", "2026-08", "2026-09"],
      [
        line("2026-07", "salary", "6000"),
        line("2026-07", "food", "-3000"), // 50 %
        line("2026-08", "salary", "6000"),
        line("2026-08", "food", "-6000"), // 0 %
        line("2026-09", "salary", "6000"),
        line("2026-09", "food", "-4500"), // 25 %
      ],
      cats,
      "EUR",
    );
    const totals = periodTotals(months, "EUR");
    expect(totals.income.equals(eur("18000"))).toBe(true);
    expect(totals.expenses.equals(eur("13500"))).toBe(true);
    expect(ratePercent(totals.savingsRate)).toBe("25.0");
    expect(ratePercent(totals.averageMonthlyRate)).toBe("25.0");
    expect(totals.highest).toBe("2026-07");
    expect(totals.lowest).toBe("2026-08");

    const withEmpty = monthFigures(
      ["2026-07", "2026-08"],
      [line("2026-07", "salary", "1000"), line("2026-07", "food", "-900"), line("2026-08", "food", "-50")],
      cats,
      "EUR",
    );
    // Only July has income: the mean is July's 10 %; the period's (1000 − 950) ÷ 1000 = 5 %.
    const t2 = periodTotals(withEmpty, "EUR");
    expect(ratePercent(t2.averageMonthlyRate)).toBe("10.0");
    expect(ratePercent(t2.savingsRate)).toBe("5.0");
  });
});
