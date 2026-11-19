import { describe, expect, it } from "vitest";
import { Money } from "@willowsum/domain-kernel";
import { budgetReads } from "./services.ts";

/** Security review of #605 (BUD-06@PoC a): the cap (#586) of the one window read, after the conversion too. Synthetic. */
const usd = (a: string) => Money.of(a, "USD");
const eur = (a: string) => Money.of(a, "EUR");
type Fx = Parameters<typeof budgetReads>[0]["fx"];

function reads(rows: { amount: Money; date: string }[], total: Fx["total"]) {
  return budgetReads({
    categories: { categories: async () => [] },
    accounts: { accounts: async () => [] },
    transactions: {
      firstDate: async () => null,
      inPeriod: async () =>
        rows.map((r, i) => ({ id: `t${i}`, accountId: "a", amount: r.amount, date: r.date, parts: null })),
    },
    categorization: { categoriesOf: async () => new Map() },
    fx: { total },
  });
}

describe("BUD-06@PoC (security review of #605): the cap of the window read", () => {
  it("BUD-06@PoC FR 4: an amount that passes 15 integer digits only after the conversion is left out of the window, not summed", async () => {
    const rows = [
      { amount: usd("-" + "9".repeat(15)), date: "2026-10-03" },
      { amount: usd("-2"), date: "2026-11-03" },
    ];
    const r = reads(rows, async (xs) => ({
      currency: "EUR",
      total: null,
      approximate: true,
      nearestRateCount: 1,
      staleRateCount: 0,
      unavailableCount: 0,
      restricted: false,
      items: xs.map((x, i) => ({
        kind: "converted" as const,
        original: x.amount,
        value: i === 0 ? eur("-" + "9".repeat(16)) : eur("-1"),
        conversion: { approximate: i === 0 },
      })) as never,
    }));
    const window = await r.window("h", ["a"], "2026-10-01", "2026-11-12", "EUR");
    expect(window.amounts.map((a) => [a.amount.toDecimalString(), a.period])).toEqual([["-1", "2026-11"]]);
    expect(window).toMatchObject({ nearestRateCount: 0, unavailableCount: 1 });
  });
});
