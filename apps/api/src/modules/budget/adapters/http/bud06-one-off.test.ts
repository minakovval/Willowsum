import { describe, expect, it } from "vitest";
import { Money } from "@willowsum/domain-kernel";
import { budgetReads } from "./services.ts";

/**
 * BUD-06@PoC FR 8 «Одноразова витрата» over fake ports: the budget's reads keep a marked expense in the fact (`amounts`,
 * `window` with `oneOff`) and leave it out only where an average asks (`withoutOneOffs`). The live routes: test/bud06-one-off.it.test.ts.
 */
const eur = (a: string) => Money.of(a, "EUR");

function reads(rows: { amount: string; oneOff?: boolean; split?: boolean }[]) {
  return budgetReads({
    categories: { categories: async () => [] },
    accounts: { accounts: async () => [] },
    transactions: {
      firstDate: async () => null,
      inPeriod: async () =>
        rows.map((r, i) => ({
          id: `t${i}`,
          accountId: "a",
          amount: eur(r.amount),
          date: "2026-08-14",
          parts: r.split
            ? [
                { categoryId: "c1", month: null, amount: eur("-1000") },
                { categoryId: "c2", month: null, amount: eur(r.amount).minus(eur("-1000")) },
              ]
            : null,
          ...(r.oneOff === undefined ? {} : { oneOff: r.oneOff }),
        })),
    },
    categorization: { categoriesOf: async () => new Map() },
    fx: {
      total: async (xs) => ({
        currency: "EUR",
        total: null,
        approximate: false,
        nearestRateCount: 0,
        staleRateCount: 0,
        unavailableCount: 0,
        restricted: false,
        items: xs.map((x) => ({ kind: "reporting-currency" as const, original: x.amount, value: x.amount })),
      }),
    },
  });
}

describe("BUD-06@PoC FR 8: «Одноразова витрата» in the budget's reads", () => {
  it("BUD-06@PoC FR 8: a marked expense stays in the period's fact; only `withoutOneOffs` (an average) leaves it out", async () => {
    const r = reads([
      { amount: "-3500.00", oneOff: true },
      { amount: "-100.00", oneOff: false },
      { amount: "-5.00" },
    ]);
    const fact = await r.amounts("h", ["a"], "2026-08", "EUR");
    expect(fact.amounts.map((a) => a.amount.toDecimalString())).toEqual(["-3500", "-100", "-5"]);
    const average = await r.amounts("h", ["a"], "2026-08", "EUR", undefined, undefined, {
      withoutOneOffs: true,
    });
    expect(average.amounts.map((a) => a.amount.toDecimalString())).toEqual(["-100", "-5"]);
    // Left out on purpose — never counted as «Курс недоступний».
    expect(average.unavailableCount).toBe(0);
  });

  it("BUD-06@PoC FR 8: the window keeps every amount with its mark — the compare's average drops the marked ones itself; a split one marks each part", async () => {
    const r = reads([{ amount: "-3500.00", oneOff: true, split: true }, { amount: "-100.00" }]);
    const w = await r.window("h", ["a"], "2026-08-01", "2026-08-31", "EUR");
    expect(w.amounts.map((a) => [a.amount.toDecimalString(), a.oneOff])).toEqual([
      ["-1000", true],
      ["-2500", true],
      ["-100", false],
    ]);
  });
});
