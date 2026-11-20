import { describe, expect, it } from "vitest";
import { AmountOutOfRangeError, Money } from "@willowsum/domain-kernel";
import { budgetReads } from "./services.ts";

/**
 * #586: «Витрачено» over fake ports — the cap on amounts before the conversion and the sums. The live reads:
 * test/bud02-budget.it.test.ts («#586»).
 */
const eur = (a: string) => Money.of(a, "EUR");
type Fx = Parameters<typeof budgetReads>[0]["fx"];

function reads(amounts: Money[], fx?: Fx["total"]) {
  const passed: number[] = [];
  const total: Fx["total"] =
    fx ??
    (async (xs) => {
      passed.push(xs.length);
      return {
        currency: "EUR",
        total: null,
        approximate: false,
        nearestRateCount: 0,
        staleRateCount: 0,
        unavailableCount: 0,
        restricted: false,
        items: xs.map((x) => ({ kind: "reporting-currency" as const, original: x.amount, value: x.amount })),
      };
    });
  const r = budgetReads({
    categories: { categories: async () => [] },
    accounts: { accounts: async () => [] },
    transactions: {
      firstDate: async () => null,
      inPeriod: async () =>
        amounts.map((amount, i) => ({
          id: `t${i}`,
          accountId: "a",
          amount,
          date: "2026-11-03",
          parts: null,
        })),
    },
    categorization: { categoriesOf: async () => new Map() },
    fx: { total },
  });
  return { passed, read: () => r.amounts("h", ["a"], "2026-11", "EUR") };
}

describe("#586: the cap on «Витрачено»", () => {
  it("BUD-02@PoC FR 12: an amount over 15 integer digits is left out before the conversion; 15 digits still counts", async () => {
    const { passed, read } = reads([eur("-" + "9".repeat(16)), eur("-" + "9".repeat(15)), eur("-1")]);
    const r = await read();
    expect(passed).toEqual([2]);
    expect(r.amounts.map((a) => a.amount.toDecimalString())).toEqual(["-" + "9".repeat(15), "-1"]);
    expect(r.unavailableCount).toBe(1);
  });

  it("BUD-02@PoC FR 12: amounts whose absolute values add up past the bound give no figure — all left out, never a sum beyond the money type", async () => {
    const { read } = reads(Array.from({ length: 1001 }, () => eur("-" + "9".repeat(15))));
    expect(await read()).toEqual({ amounts: [], nearestRateCount: 0, unavailableCount: 1001 });
  });

  it("BUD-02@PoC FR 12: the rates' reader leaving the money type in its own sum leaves out only the amount that leaves it alone, never a 500 (#594)", async () => {
    const { read } = reads([eur("-1"), eur("-9" + "0".repeat(14)), eur("-2")], async (xs) => {
      if (xs.length > 1 || xs[0]!.amount.amount.abs().greaterThan(100)) throw new AmountOutOfRangeError();
      return {
        currency: "EUR",
        total: null,
        approximate: false,
        nearestRateCount: 0,
        staleRateCount: 0,
        unavailableCount: 0,
        restricted: false,
        items: xs.map((x) => ({ kind: "reporting-currency" as const, original: x.amount, value: x.amount })),
      };
    });
    const r = await read();
    expect(r.amounts.map((a) => a.amount.toDecimalString())).toEqual(["-1", "-2"]);
    expect(r.unavailableCount).toBe(1);
  });

  it("BUD-02@PoC FR 12: above 1 000 amounts the one-by-one fallback is not tried — one rates call at most for the sum, all left out (#594)", async () => {
    let calls = 0;
    const { read } = reads(
      Array.from({ length: 1001 }, () => eur("-1")),
      async () => {
        calls += 1;
        throw new AmountOutOfRangeError();
      },
    );
    expect(await read()).toEqual({ amounts: [], nearestRateCount: 0, unavailableCount: 1001 });
    expect(calls).toBe(1);
  });
});
