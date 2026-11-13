import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { balanceMovements } from "./index.ts";

/** ARC-11@PoC «Баланси і продуктивність»: what an entry adds to the daily balance cache of each of its accounts. */

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const eur = (amount: string) => Money.of(amount, "EUR");

describe("ARC-11: the movements of an entry on the balance cache", () => {
  it("ARC-11: debit and credit totals per account, exact decimals, in the order of the account ids", () => {
    const moves = balanceMovements([
      { debitAccountId: C, creditAccountId: A, amount: eur("0.1") },
      { debitAccountId: C, creditAccountId: B, amount: eur("0.2") },
      { debitAccountId: A, creditAccountId: B, amount: eur("0.000000000000000001") },
    ]);
    expect(moves.map((m) => m.accountId)).toEqual([A, B, C]);
    const totals = moves.map((m) => [m.debits.toDecimalString(), m.credits.toDecimalString()]);
    // 0.1 + 0.2 is exactly 0.3: Money, never floats.
    expect(totals).toEqual([
      ["0.000000000000000001", "0.1"],
      ["0", "0.200000000000000001"],
      ["0.3", "0"],
    ]);
    expect(moves.every((m) => m.debits.currency === "EUR" && m.credits.currency === "EUR")).toBe(true);
  });

  it("ARC-11: a reversal's movements offset the original's on every account", () => {
    const original = [
      { debitAccountId: A, creditAccountId: B, amount: eur("12.345") },
      { debitAccountId: A, creditAccountId: C, amount: eur("3150") },
    ];
    const reversal = original.map((p) => ({
      ...p,
      debitAccountId: p.creditAccountId,
      creditAccountId: p.debitAccountId,
    }));
    const net = (ps: typeof original) =>
      Object.fromEntries(
        balanceMovements(ps).map((m) => [m.accountId, m.debits.minus(m.credits).toDecimalString()]),
      );
    const a = net(original);
    const b = net(reversal);
    for (const id of [A, B, C])
      expect(Money.of(a[id]!, "EUR").plus(Money.of(b[id]!, "EUR")).isZero(), id).toBe(true);
  });

  it("an entry without postings moves nothing", () => {
    expect(balanceMovements([])).toEqual([]);
  });
});
