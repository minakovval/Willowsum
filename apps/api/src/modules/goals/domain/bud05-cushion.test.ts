import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { averageMonthlyExpenses, countsAsSpending, cushionSpending, cushionWindow } from "./goals.ts";

const eur = (a: string) => Money.of(a, "EUR");

describe("BUD-05@PoC FR 10: the average monthly expenses of «Подушка безпеки»", () => {
  it("BUD-05@PoC FR 10: the window is the 6 full months before this month, across a year", () => {
    expect(cushionWindow("2026-11-15")).toEqual({ from: "2026-05-01", to: "2026-10-31" });
    expect(cushionWindow("2027-02-01")).toEqual({ from: "2026-08-01", to: "2027-01-31" });
    expect(cushionWindow("2026-03-31")).toEqual({ from: "2025-09-01", to: "2026-02-28" });
  });

  it("BUD-05@PoC AC3: 25 200 € over 6 months is 4 200 € a month", () => {
    const a = averageMonthlyExpenses(eur("25200"), "2026-05-03", "2026-11-15");
    expect(a.months).toBe(6);
    expect(a.average?.toJSON()).toEqual({ amount: "4200", currency: "EUR" });
  });

  it("BUD-05@PoC FR 10: a shorter history averages over its own months; at most 6; half to even to minor units", () => {
    expect(averageMonthlyExpenses(eur("100.01"), "2026-09-15", "2026-11-15")).toMatchObject({ months: 2 });
    expect(averageMonthlyExpenses(eur("100.01"), "2026-09-15", "2026-11-15").average?.toJSON().amount).toBe(
      "50",
    );
    expect(averageMonthlyExpenses(eur("100.03"), "2026-09-15", "2026-11-15").average?.toJSON().amount).toBe(
      "50.02",
    );
    expect(averageMonthlyExpenses(eur("60"), "2020-01-01", "2026-11-15").months).toBe(6);
    expect(
      averageMonthlyExpenses(Money.of("1001", "JPY"), "2026-09-01", "2026-11-15").average?.toJSON(),
    ).toEqual({ amount: "500", currency: "JPY" });
  });

  it("BUD-05@PoC FR 10: without an expense there is no average", () => {
    expect(averageMonthlyExpenses(eur("0"), null, "2026-11-15")).toEqual({ average: null, months: 0 });
  });
});

describe("BUD-05@PoC FR 10: spending as the budget counts it", () => {
  const categories = new Map([
    ["food", { id: "food", kind: "expense" as const, state: "active", mergedInto: null }],
    ["old", { id: "old", kind: "expense" as const, state: "retired", mergedInto: "food" }],
    ["salary", { id: "salary", kind: "income" as const, state: "active", mergedInto: null }],
    ["transfer", { id: "transfer", kind: "service" as const, state: "active", mergedInto: null }],
  ]);
  const at = (categoryId: string | null, amount: string) => ({ categoryId, amount: eur(amount) });

  it("BUD-05@PoC FR 10: a refund lowers its category; a merged category counts in its target; service, income and uncategorised inflows are not spending", () => {
    expect(countsAsSpending(categories, "transfer", eur("-700"))).toBe(false);
    expect(countsAsSpending(categories, "salary", eur("-50"))).toBe(false);
    expect(countsAsSpending(categories, null, eur("300"))).toBe(false);
    expect(countsAsSpending(categories, null, eur("-120"))).toBe(true);
    expect(countsAsSpending(categories, "old", eur("20"))).toBe(true);
    const total = cushionSpending(
      [
        at("food", "-1000"),
        at("food", "1000"),
        at("transfer", "-700"),
        at(null, "-120"),
        at("old", "20"),
        at(null, "300"),
      ],
      categories,
      "EUR",
    );
    expect(total.toJSON()).toEqual({ amount: "100", currency: "EUR" });
  });

  it("BUD-05@PoC FR 10: refunds beyond the window's spending never make it negative", () => {
    expect(cushionSpending([at("food", "500")], categories, "EUR").toJSON()).toEqual({
      amount: "0",
      currency: "EUR",
    });
  });
});
