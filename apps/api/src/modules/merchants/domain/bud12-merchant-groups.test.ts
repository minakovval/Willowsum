import { describe, expect, it } from "vitest";
import { groupReviewQueue, NO_MERCHANT_GROUP, suggestGroupCategory, type Merchant } from "./index.ts";

/**
 * BUD-12@PoC FR 14–16 (server part): «До розбору» in the mode «Мерчанти» — pure rules of the groups. Names and amounts
 * are synthetic.
 */

const merchant = (id: string, name: string, mergedInto: string | null = null): Merchant => ({
  id,
  key: name.toLowerCase(),
  name,
  intermediary: false,
  mergedInto,
  version: 1,
});

const SILPO = merchant("00000000-0000-4000-8000-000000000001", "Сільпо");
const SHELL = merchant("00000000-0000-4000-8000-000000000002", "Shell");

describe("BUD-12@PoC FR 14 (server part): the queue grouped by merchant", () => {
  it("BUD-12@PoC FR 14: descriptions of one shown merchant are one group — count and the exact sum per currency, the largest group first", () => {
    const shown = new Map([
      ["POS SILPO 1234", SILPO],
      ["SILPO 0042 KYIV", SILPO],
      ["SHELL 77", SHELL],
    ]);
    const groups = groupReviewQueue(
      [
        {
          counterparty: "POS SILPO 1234",
          currency: "UAH",
          count: 10,
          total: "-1000.10",
          oldest: "2026-11-03",
        },
        { counterparty: "SILPO 0042 KYIV", currency: "UAH", count: 8, total: "-0.20", oldest: "2026-11-01" },
        { counterparty: "SILPO 0042 KYIV", currency: "EUR", count: 1, total: "-0.1", oldest: "2026-11-05" },
        { counterparty: "SHELL 77", currency: "EUR", count: 4, total: "-206.00", oldest: "2026-10-30" },
      ],
      shown,
    );
    expect(groups.map((g) => [g.merchant?.name, g.count])).toEqual([
      ["Сільпо", 19],
      ["Shell", 4],
    ]);
    // No float: 0.1 + 0.2 kind of sums stay exact; one total per currency, by code.
    expect(groups[0]!.totals.map((m) => m.toJSON())).toEqual([
      { amount: "-0.1", currency: "EUR" },
      { amount: "-1000.3", currency: "UAH" },
    ]);
    expect(groups[0]).toMatchObject({
      key: SILPO.id,
      oldest: "2026-11-01",
      counterparty: "POS SILPO 1234",
      counterparties: ["POS SILPO 1234", "SILPO 0042 KYIV"],
      none: false,
    });
  });

  it("BUD-12@PoC FR 14: transactions without a merchant are one bucket of their own (the web shows them as cards one by one, no group, owner 2026-11-26); equal groups — the oldest first", () => {
    const groups = groupReviewQueue(
      [
        { counterparty: null, currency: "EUR", count: 2, total: "-3.00", oldest: "2026-11-09" },
        { counterparty: "***", currency: "EUR", count: 1, total: "-1.00", oldest: "2026-11-02" },
        { counterparty: "SHELL 77", currency: "EUR", count: 3, total: "-9.00", oldest: "2026-11-04" },
      ],
      new Map([["SHELL 77", SHELL]]),
    );
    expect(groups.map((g) => [g.key, g.count, g.oldest])).toEqual([
      [NO_MERCHANT_GROUP, 3, "2026-11-02"],
      [SHELL.id, 3, "2026-11-04"],
    ]);
    expect(groups[0]).toMatchObject({
      merchant: null,
      none: true,
      counterparties: ["***"],
      counterparty: "***",
    });
  });
});

describe("BUD-12@PoC FR 14 (server part): the suggested category of a group", () => {
  it("BUD-12@PoC FR 14: the category most of the group has; «Без категорії» only when none has one", () => {
    expect(suggestGroupCategory(["a", "b", "a", null])).toEqual({ categoryId: "a", mixed: true });
    expect(suggestGroupCategory(["a", "a"])).toEqual({ categoryId: "a", mixed: false });
    expect(suggestGroupCategory([null, null])).toEqual({ categoryId: null, mixed: false });
    // A tie goes to the lower id, so the suggestion never flips between two reads.
    expect(suggestGroupCategory(["b", "a"])).toEqual({ categoryId: "a", mixed: true });
  });
});
