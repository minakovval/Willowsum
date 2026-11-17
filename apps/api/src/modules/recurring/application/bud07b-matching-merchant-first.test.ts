import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { trackSpace, type TrackingDeps } from "./tracking.ts";
import type { StoredPayment } from "./payments.ts";
import { trackPayment } from "../domain/index.ts";

const eur = (a: string) => Money.of(a, "EUR");
const ids = { a: "00000000-0000-4000-8000-00000000000a", b: "00000000-0000-4000-8000-00000000000b" };
function pay(id: string, name: string, merchantId: string, amount: string, createdOn: string): StoredPayment {
  return {
    id,
    name,
    expected: eur(amount),
    frequency: "month",
    anchorDate: "2026-06-05",
    categoryId: "subs",
    accountId: null,
    endDate: null,
    type: "expense",
    subscription: true,
    variable: false,
    merchantId,
    source: "proposal",
    createdOn,
    version: 1,
    current: null,
    keptOn: null,
  } as StoredPayment;
}
const tx = (id: string, date: string, amount: string, cp: string) => ({
  id,
  accountId: "acc",
  date,
  amount: `-${amount}`,
  currency: "EUR",
  counterparty: cp,
});

describe("BUD-07@PoC FR 8: a transaction of the merchant first; another payment's merchant is never taken by the category", () => {
  it("BUD-07@PoC FR 8: Netflix and Spotify in one category — each charge is paid by its own merchant's transaction", async () => {
    const found = [
      tx("n1", "2026-06-05", "11.99", "NETFLIX"),
      tx("s1", "2026-06-05", "10.99", "SPOTIFY"),
      // July: Spotify on the 5th, Netflix on the 7th
      tx("s2", "2026-07-05", "10.99", "SPOTIFY"),
      tx("n2", "2026-07-07", "12.50", "NETFLIX"),
    ];
    const deps: TrackingDeps = {
      history: { matching: async () => found },
      merchants: {
        shownMerchants: async () =>
          new Map([
            ["NETFLIX", { id: "mN", name: "Netflix" }],
            ["SPOTIFY", { id: "mS", name: "Spotify" }],
          ]),
      },
      categories: { categoriesOf: async () => new Map(found.map((f) => [f.id, "subs"])) },
      convert: async () => null,
      today: () => "2026-07-20",
      newId: () => "x",
    } as unknown as TrackingDeps;
    const r = await trackSpace(
      deps,
      "h",
      [
        pay(ids.a, "Netflix", "mN", "11.99", "2026-06-01"),
        pay(ids.b, "Spotify", "mS", "10.99", "2026-06-02"),
      ],
      [],
    );
    const a = r.byPayment.get(ids.a)!,
      b = r.byPayment.get(ids.b)!;
    //, JSON.stringify(a.charges.map((c) => [c.dueOn, c.status, c.transactionId])), a.expected.toJSON());
    //, JSON.stringify(b.charges.map((c) => [c.dueOn, c.status, c.transactionId])), b.expected.toJSON());
    expect(a.charges.find((c) => c.dueOn === "2026-07-05")?.transactionId).toBe("n2");
    expect(b.charges.find((c) => c.dueOn === "2026-07-05")?.transactionId).toBe("s2");
    expect(a.expected.equals(eur("11.99"))).toBe(true); // no system change of Netflix to 10,99 €
  });
  it("BUD-07@PoC FR 8: a transaction of the merchant pays the charge before a closer one of the category", () => {
    const base = { value: eur("40.00"), amount: eur("40.00"), converted: false, approximate: false };
    const t = trackPayment({
      frequency: "month",
      anchorDate: "2026-06-05",
      endDate: null,
      createdOn: "2026-06-01",
      keptOn: null,
      type: "expense",
      base: eur("40.00"),
      variable: false,
      marks: new Map(),
      from: "2025-09-12",
      today: "2026-06-20",
      candidates: [
        { id: "cat", date: "2026-06-05", merchant: false, category: true, ...base },
        { id: "mer", date: "2026-06-07", merchant: true, category: true, ...base },
      ],
    });
    // console.log(JSON.stringify(t.charges.map((c) => [c.dueOn, c.status, c.transactionId])));
    expect(t.charges[0]!.transactionId).toBe("mer");
  });
  it("BUD-07@PoC FR 8: Netflix not charged this month is not paid by Spotify's transaction (same category, close amount)", async () => {
    const found = [tx("s2", "2026-07-05", "10.99", "SPOTIFY")];
    const deps = {
      history: { matching: async () => found },
      merchants: { shownMerchants: async () => new Map([["SPOTIFY", { id: "mS", name: "Spotify" }]]) },
      categories: { categoriesOf: async () => new Map(found.map((f) => [f.id, "subs"])) },
      convert: async () => null,
      today: () => "2026-07-20",
      newId: () => "x",
    } as unknown as TrackingDeps;
    const r = await trackSpace(
      deps,
      "h",
      [
        pay(ids.a, "Netflix", "mN", "11.99", "2026-06-01"),
        pay(ids.b, "Spotify", "mS", "10.99", "2026-06-02"),
      ],
      [],
    );
    expect(r.byPayment.get(ids.a)!.charges.find((c) => c.dueOn === "2026-07-05")?.status).toBe("overdue");
    expect(r.byPayment.get(ids.a)!.expected.equals(eur("11.99"))).toBe(true);
    expect(r.byPayment.get(ids.b)!.charges.find((c) => c.dueOn === "2026-07-05")?.transactionId).toBe("s2");
  });
});
