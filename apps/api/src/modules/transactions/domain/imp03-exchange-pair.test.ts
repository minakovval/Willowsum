import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { orderPair, transferFee, transferRateRequest, type PairSide } from "./transfers.ts";

/** IMP-03@PoC a) (wave 2 row 47): «Підтвердити» of an exchange between two wallets of one account, without I/O. */
const A = "11111111-1111-4111-8111-111111111111";

function side(id: string, amount: string, currency: string): PairSide {
  return {
    id,
    accountId: A,
    amount: Money.of(amount, currency),
    date: "2026-03-02",
    status: "posted",
    hidden: false,
    split: null,
    transfer: null,
  };
}

const uah = side("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "-1000.00", "UAH");
const eur = side("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "22.50", "EUR");

describe("IMP-03@PoC FR 2, FR 9: an exchange between wallets of one account is confirmed as a transfer", () => {
  it("IMP-03@PoC FR 9: −1 000 UAH and +22,50 EUR on two wallets of one account pair; the rate is the credit's currency in the debit's, no fee", () => {
    expect(orderPair(eur, uah)).toEqual({ outflow: uah, inflow: eur });
    expect(transferFee(uah, eur)).toBeNull();
    expect(transferRateRequest(uah, eur)).toEqual({ from: "EUR", to: "UAH", date: "2026-03-02" });
  });

  it("IMP-03@PoC FR 2: one wallet (one currency) of one account is still no pair", () => {
    expect(orderPair(uah, side(eur.id, "1000.00", "UAH"))).toEqual([
      { field: "counterpartId", issue: "same_account" },
    ]);
  });
});
