import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { postingsFor, reversalOf } from "./index.ts";

/**
 * IMP-02@PoC FR 5, AC11 (#698): a transaction whose amount includes the bank's fee (an imported monobank row) is one
 * entry with the operation's main leg and a separate fee leg, and moves the account by the amount as before.
 */
const WALLET = "00000000-0000-4000-8000-00000000000a";
const uah = (amount: string) => Money.of(amount, "UAH");
const EXTERNAL = { service: "external-funds" };
const code = (f: () => unknown) => {
  try {
    f();
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code;
  }
};
/** What the entry moves on the wallet, from its side. */
const moved = (postings: ReturnType<typeof postingsFor>) =>
  postings.reduce(
    (sum, p) =>
      "account" in p.debit && p.debit.account === WALLET
        ? sum.plus(p.amount)
        : "account" in p.credit && p.credit.account === WALLET
          ? sum.minus(p.amount)
          : sum,
    uah("0"),
  );

describe("IMP-02@PoC FR 5: a transaction with the bank's fee in its amount", () => {
  it("IMP-02@PoC AC11: −4 641,00 with a fee of 91,00 — a main leg of −4 550,00 and a fee leg of 91,00; the wallet moves by −4 641,00", () => {
    const postings = postingsFor({
      type: "transaction",
      account: WALLET,
      amount: uah("-4641.00"),
      fee: uah("91.00"),
    });
    expect(postings).toEqual([
      { debit: EXTERNAL, credit: { account: WALLET }, amount: uah("4550.00"), leg: "main" },
      { debit: EXTERNAL, credit: { account: WALLET }, amount: uah("91.00"), leg: "fee" },
    ]);
    expect(moved(postings).equals(uah("-4641"))).toBe(true);
  });

  it("IMP-02@PoC FR 5: an income of 1 000,00 with a fee of 10,00 — main leg +1 010,00, the wallet still gets 1 000,00", () => {
    const postings = postingsFor({
      type: "transaction",
      account: WALLET,
      amount: uah("1000.00"),
      fee: uah("10.00"),
    });
    expect(postings.map((p) => [p.leg, p.amount.toDecimalString()])).toEqual([
      ["main", "1010"],
      ["fee", "10"],
    ]);
    expect(moved(postings).equals(uah("1000"))).toBe(true);
  });

  it("IMP-02@PoC FR 5: without a fee the transaction is one plain posting, as before", () => {
    expect(postingsFor({ type: "transaction", account: WALLET, amount: uah("-50.00") })).toEqual([
      { debit: EXTERNAL, credit: { account: WALLET }, amount: uah("50.00") },
    ]);
    expect(
      postingsFor({ type: "transaction", account: WALLET, amount: uah("-50.00"), fee: null }),
    ).toHaveLength(1);
  });

  it("IMP-02@PoC FR 5: a reversal keeps both legs with the sides swapped", () => {
    const postings = postingsFor({
      type: "transaction",
      account: WALLET,
      amount: uah("-2020.00"),
      fee: uah("20.00"),
    });
    expect(reversalOf(postings).map((p) => p.leg)).toEqual(["main", "fee"]);
    expect(moved(reversalOf(postings)).equals(uah("2020"))).toBe(true);
  });

  it("IMP-02@PoC FR 5: a fee that is zero, negative, in another currency or all of the amount is refused", () => {
    const tx = (amount: string, fee: Money) => () =>
      postingsFor({ type: "transaction", account: WALLET, amount: uah(amount), fee });
    expect(code(tx("-10.00", uah("0")))).toBe("INVALID_EVENT");
    expect(code(tx("-10.00", uah("-1.00")))).toBe("INVALID_EVENT");
    expect(code(tx("-10.00", Money.of("1.00", "EUR")))).toBe("INVALID_EVENT");
    expect(code(tx("-10.00", uah("10.00")))).toBe("INVALID_EVENT");
  });
});
