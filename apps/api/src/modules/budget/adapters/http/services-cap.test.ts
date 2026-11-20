import { describe, expect, it } from "vitest";
import { Money } from "@willowsum/domain-kernel";
import { budgetReads } from "./services.ts";

/** #594: the survivors of the mutation run on `budgetReads().amounts` (#586, review of #591). */
const eur = (a: string) => Money.of(a, "EUR");
type Fx = Parameters<typeof budgetReads>[0]["fx"];
const same: Fx["total"] = async (xs) => ({
  currency: "EUR",
  total: null,
  approximate: false,
  nearestRateCount: 0,
  staleRateCount: 0,
  unavailableCount: 0,
  restricted: false,
  items: xs.map((x) => ({ kind: "reporting-currency" as const, original: x.amount, value: x.amount })),
});

function read(amounts: Money[], total: Fx["total"] = same) {
  return budgetReads({
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
    categorization: { categoriesOf: async (_h, ids) => new Map(ids.map((id) => [id, `cat-${id}`])) },
    fx: { total },
  }).amounts("h", ["a"], "2026-11", "EUR");
}

describe("#586 (#594): the cap on «Витрачено», survivors of the mutation run", () => {
  it("BUD-02@PoC FR 12: an amount after one left out before the conversion keeps its own category", async () => {
    const r = await read([eur("-" + "9".repeat(16)), eur("-7"), eur("-" + "9".repeat(20)), eur("-8")]);
    expect(r.amounts.map((a) => [a.categoryId, a.amount.toDecimalString()])).toEqual([
      ["cat-t1", "-7"],
      ["cat-t3", "-8"],
    ]);
    expect(r.unavailableCount).toBe(2);
  });

  it("BUD-02@PoC FR 12: a value over 15 integer digits after the conversion is left out, counted, and no longer «приблизно»", async () => {
    const r = await read([Money.of("-10", "GBP"), Money.of("-1", "GBP")], async (xs) => ({
      ...(await same(xs)),
      approximate: true,
      nearestRateCount: 2,
      items: xs.map((x, i) => ({
        kind: "converted" as const,
        original: x.amount,
        value: eur(i === 0 ? "-" + "9".repeat(16) : "-1.17"),
        conversion: { approximate: true } as never,
        restricted: false,
      })),
    }));
    expect(r.amounts.map((a) => [a.categoryId, a.amount.toDecimalString()])).toEqual([["cat-t1", "-1.17"]]);
    expect(r).toMatchObject({ nearestRateCount: 1, unavailableCount: 1 });
  });

  it("BUD-02@PoC FR 12: absolute values adding up to exactly 10^18 still count; one unit more — none", async () => {
    const at = [...Array.from({ length: 1000 }, () => eur("-" + "9".repeat(15))), eur("1000")];
    expect((await read(at)).amounts).toHaveLength(1001);
    expect(await read([...at, eur("0.01")])).toEqual({
      amounts: [],
      nearestRateCount: 0,
      unavailableCount: 1002,
    });
  });
});
