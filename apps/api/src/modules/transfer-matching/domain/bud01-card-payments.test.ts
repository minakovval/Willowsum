import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { cardPaymentsOf } from "./card-payments.ts";
import { proposalOf, type TransferProposal } from "./matching.ts";

/** BUD-01@PoC FR 7, AC4 (#722 D): which proposals are card payments from an own account, marked at once — no I/O. */
const CURRENT = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const SAVINGS = "33333333-3333-4333-8333-333333333333";
const CARD_2 = "44444444-4444-4444-8444-444444444444";

function proposal(outId: string, outAccount: string, inId: string, inAccount: string): TransferProposal {
  const p = proposalOf(
    {
      outflow: {
        transactionId: outId,
        accountId: outAccount,
        amount: Money.of("-1200.00", "EUR"),
        date: "2026-10-13",
      },
      inflow: {
        transactionId: inId,
        accountId: inAccount,
        amount: Money.of("1200.00", "EUR"),
        date: "2026-10-15",
      },
    },
    null,
  );
  if (!p) throw new Error("not a proposal");
  return p;
}

const cards = new Set([CARD, CARD_2]);
const all = () => true;

describe("BUD-01@PoC FR 7: a payment to a credit card from a known own account is a transfer at once", () => {
  it("BUD-01@PoC AC4: −1 200 € on the current account and +1 200 € on the card 2 days later — marked", () => {
    const p = proposal("out-1", CURRENT, "in-1", CARD);
    expect(cardPaymentsOf([p], cards, all)).toEqual([p]);
  });

  it("BUD-01@PoC FR 7: a pair between two current accounts is no card payment — it stays a proposal (AC22)", () => {
    expect(cardPaymentsOf([proposal("out-1", CURRENT, "in-1", SAVINGS)], cards, all)).toEqual([]);
  });

  it("BUD-01@PoC FR 7: a debit from the card itself onto another account is no payment to the card", () => {
    expect(cardPaymentsOf([proposal("out-1", CARD, "in-1", CURRENT)], cards, all)).toEqual([]);
  });

  it("BUD-01@PoC FR 7: only a pair with a side just arrived is marked — an older pair the person left unmarked is not", () => {
    const p = proposal("out-1", CURRENT, "in-1", CARD);
    expect(cardPaymentsOf([p], cards, () => false)).toEqual([]);
    expect(cardPaymentsOf([p], cards, (id) => id === "in-1")).toEqual([p]);
    expect(cardPaymentsOf([p], cards, (id) => id === "out-1")).toEqual([p]);
  });

  it("BUD-01@PoC FR 7: a debit that fits two credits (two cards, or a card and a current account) is ambiguous — none marked", () => {
    const toCard = proposal("out-1", CURRENT, "in-1", CARD);
    expect(cardPaymentsOf([toCard, proposal("out-1", CURRENT, "in-2", CARD_2)], cards, all)).toEqual([]);
    expect(cardPaymentsOf([toCard, proposal("out-1", CURRENT, "in-3", SAVINGS)], cards, all)).toEqual([]);
    // A card's credit that fits two debits: none either.
    expect(cardPaymentsOf([toCard, proposal("out-2", SAVINGS, "in-1", CARD)], cards, all)).toEqual([]);
  });

  it("BUD-01@PoC FR 7: an account not among the space's cards never counts as one (another space's card is unknown here)", () => {
    expect(cardPaymentsOf([proposal("out-1", CURRENT, "in-1", CARD)], new Set(), all)).toEqual([]);
  });
});
