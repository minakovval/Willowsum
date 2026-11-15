import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { MAX_LEGS, postingsFor, reversalOf, type LedgerEvent } from "./index.ts";

/** IMP-02@PoC FR 5, FR 6 on the posting rules: an event with legs and a separate fee leg, exact amounts. */

const EUR_WALLET = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const eur = (amount: string) => Money.of(amount, "EUR");
const EXTERNAL = { service: "external-funds" };
const code = (f: () => unknown) => {
  try {
    f();
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

describe("IMP-02@PoC FR 5: an event has one or more legs and a separate fee leg", () => {
  it("IMP-02@PoC FR 5: a spending of 40 EUR with a bank fee of 1,50 EUR — one main posting and one fee posting, each marked with its leg", () => {
    const postings = postingsFor({
      type: "legs",
      legs: [{ account: EUR_WALLET, amount: eur("-40.00") }],
      fee: { account: EUR_WALLET, amount: eur("1.50") },
    });
    expect(postings).toEqual([
      { debit: EXTERNAL, credit: { account: EUR_WALLET }, amount: eur("40.00"), leg: "main" },
      { debit: EXTERNAL, credit: { account: EUR_WALLET }, amount: eur("1.50"), leg: "fee" },
    ]);
  });

  it("several legs, each against «Зовнішні кошти», in their order; without a fee no fee posting", () => {
    const postings = postingsFor({
      type: "legs",
      legs: [
        { account: EUR_WALLET, amount: eur("25") },
        { account: OTHER, amount: eur("-10") },
      ],
    });
    expect(postings.map((p) => [p.leg, p.amount.toDecimalString()])).toEqual([
      ["main", "25"],
      ["main", "10"],
    ]);
    expect(postings[0]!.debit).toEqual({ account: EUR_WALLET });
    expect(postings[1]!.credit).toEqual({ account: OTHER });
  });

  it("a reversal keeps each posting in its leg", () => {
    const postings = postingsFor({
      type: "legs",
      legs: [{ account: EUR_WALLET, amount: eur("-40") }],
      fee: { account: EUR_WALLET, amount: eur("1.5") },
    });
    expect(reversalOf(postings).map((p) => [p.leg, p.debit, p.credit])).toEqual([
      ["main", { account: EUR_WALLET }, EXTERNAL],
      ["fee", { account: EUR_WALLET }, EXTERNAL],
    ]);
  });

  it.each<[string, LedgerEvent]>([
    ["no legs", { type: "legs", legs: [] }],
    ["a zero leg", { type: "legs", legs: [{ account: EUR_WALLET, amount: eur("0") }] }],
    [
      "a negative fee",
      {
        type: "legs",
        legs: [{ account: EUR_WALLET, amount: eur("-5") }],
        fee: { account: EUR_WALLET, amount: eur("-1") },
      },
    ],
    [
      "a zero fee",
      {
        type: "legs",
        legs: [{ account: EUR_WALLET, amount: eur("-5") }],
        fee: { account: EUR_WALLET, amount: eur("0") },
      },
    ],
    [
      "legs in two currencies (they need their dated rates)",
      {
        type: "legs",
        legs: [
          { account: EUR_WALLET, amount: eur("-5") },
          { account: OTHER, amount: Money.of("200", "UAH") },
        ],
      },
    ],
    [
      "a fee in another currency than the legs",
      {
        type: "legs",
        legs: [{ account: EUR_WALLET, amount: eur("-5") }],
        fee: { account: OTHER, amount: Money.of("1", "PLN") },
      },
    ],
    [
      "more legs than allowed",
      {
        type: "legs",
        legs: Array.from({ length: MAX_LEGS + 1 }, () => ({ account: EUR_WALLET, amount: eur("1") })),
      },
    ],
  ])("%s is refused as INVALID_EVENT", (_, event) => {
    expect(code(() => postingsFor(event))).toBe("INVALID_EVENT");
  });
});

describe("IMP-02@PoC FR 6: amounts are exact decimals with up to 18 places, never floats", () => {
  it("IMP-02@PoC FR 6: 0,000000000000000001 ETH is one leg of exactly that amount", () => {
    const [posting] = postingsFor({
      type: "legs",
      legs: [{ account: EUR_WALLET, amount: Money.of("0.000000000000000001", "ETH") }],
    });
    expect(posting!.amount.toDecimalString()).toBe("0.000000000000000001");
    expect(posting!.amount.currency).toBe("ETH");
  });
});
