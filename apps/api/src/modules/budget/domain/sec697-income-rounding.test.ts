import { Decimal, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  incomePlansTotal,
  roundToMinor,
  roundToTen,
  scalePlan,
  shareFrom,
  type PeriodPlan,
} from "./index.ts";

/**
 * sec697 (security review of PR #697): the money rules of «План доходу» by income category that the PR's own tests
 * leave without a failing test — the proportional first period's income plan is the sum of the scaled lines, and a
 * scaled amount rounds an exact half to the even minor unit. Pure rules; synthetic amounts.
 */
const eur = (amount: string) => Money.of(amount, "EUR");
const plan = (lines: Record<string, string>): PeriodPlan => {
  const incomePlans = Object.entries(lines).map(([categoryId, a]) => ({ categoryId, amount: eur(a) }));
  return {
    incomePlan: incomePlansTotal(incomePlans, "EUR"),
    incomePlans,
    plannedSavings: eur("0"),
    limits: [],
  };
};

describe("sec697: the sum and the rounding of «План доходу»", () => {
  it("sec697: a proportional first period's income plan is the sum of the scaled lines, never the scaled total", () => {
    // 15/30: 0.01 → 0.005 → 0.00 and 0.05 → 0.025 → 0.02 (an exact half to even); the sum 0.02 — the total 0.06 would give 0.03.
    const share = shareFrom("2026-11-16");
    expect([share.days, share.daysInPeriod]).toEqual([15, 30]);
    const scaled = scalePlan(plan({ a: "0.01", b: "0.05" }), share);
    expect(scaled.incomePlans?.map((l) => l.amount.toDecimalString())).toEqual(["0", "0.02"]);
    expect(scaled.incomePlan.toDecimalString()).toBe("0.02");
    expect(scaled.incomePlan.equals(incomePlansTotal(scaled.incomePlans ?? [], "EUR"))).toBe(true);
  });

  it("sec697: a plan without categories is scaled as one amount", () => {
    const scaled = scalePlan(
      { incomePlan: eur("0.06"), plannedSavings: eur("0"), limits: [] },
      shareFrom("2026-11-16"),
    );
    expect(scaled.incomePlan.toDecimalString()).toBe("0.03");
    const empty = scalePlan({ ...plan({}), incomePlan: eur("0.05") }, shareFrom("2026-11-16"));
    expect(empty.incomePlan.toDecimalString()).toBe("0.02");
  });

  it("sec697: an exact half goes to the even minor unit and the even ten; anything else to the nearest", () => {
    const minor = (x: string) => roundToMinor(new Decimal(x), "EUR").toDecimalString();
    expect(["0.005", "0.015", "0.025", "0.0251", "0.0149"].map(minor)).toEqual([
      "0",
      "0.02",
      "0.02",
      "0.03",
      "0.01",
    ]);
    const ten = (x: string) => roundToTen(new Decimal(x), "EUR").toDecimalString();
    expect(["5", "15", "25", "25.01", "14.99", "405", "415"].map(ten)).toEqual([
      "0",
      "20",
      "20",
      "30",
      "10",
      "400",
      "420",
    ]);
  });

  it("sec697: the sum of the lines is exact in cents and keeps the currency", () => {
    const lines = Array.from({ length: 100 }, (_, i) => ({ categoryId: `c${i}`, amount: eur("0.10") }));
    expect(incomePlansTotal(lines, "EUR").toDecimalString()).toBe("10");
    expect(incomePlansTotal([], "EUR").equals(eur("0"))).toBe(true);
    expect(() => incomePlansTotal([{ categoryId: "x", amount: Money.of("1", "USD") }], "EUR")).toThrow();
  });
});
