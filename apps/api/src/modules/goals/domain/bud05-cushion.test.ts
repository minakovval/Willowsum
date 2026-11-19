import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { averageMonthlyExpenses, cushionWindow } from "./goals.ts";

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
