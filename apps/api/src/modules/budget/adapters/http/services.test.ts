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

  it("BUD-02@PoC FR 12: the rates' reader leaving the money type in its own sum gives no figure, never a 500", async () => {
    const { read } = reads([eur("-1"), eur("-2")], async () => {
      throw new AmountOutOfRangeError();
    });
    expect(await read()).toEqual({ amounts: [], nearestRateCount: 0, unavailableCount: 2 });
  });
});
