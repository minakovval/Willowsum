import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { orderPair, transferDate, transferFee, transferRateRequest, type PairSide } from "./transfers.ts";

/** FIN-03@PoC b) (wave 2 row 16b): which two transactions may be marked as one transfer, without I/O. */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function side(id: string, accountId: string, amount: string, extra: Partial<PairSide> = {}): PairSide {
  return {
    id,
    accountId,
    amount: Money.of(amount, extra.amount?.currency ?? "EUR"),
    date: "2026-10-13",
    status: "posted",
    hidden: false,
    split: null,
    transfer: null,
    ...extra,
  };
}

const out = side("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", A, "-500.00");
const into = side("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", B, "498.00", { date: "2026-10-15" });

describe("FIN-03@PoC FR 27: «Позначити як переказ» pairs a debit on one account with a credit on another", () => {
  it("FIN-03@PoC FR 27: either side may be the one acted on; the debit is the outflow", () => {
    expect(orderPair(out, into)).toEqual({ outflow: out, inflow: into });
    expect(orderPair(into, out)).toEqual({ outflow: out, inflow: into });
  });

  it("FIN-03@PoC FR 27: one account, one direction or the transaction itself is no transfer", () => {
    expect(orderPair(out, side(into.id, A, "498.00"))).toEqual([
      { field: "counterpartId", issue: "same_account" },
    ]);
    expect(orderPair(out, side(into.id, B, "-498.00"))).toEqual([
      { field: "counterpartId", issue: "same_direction" },
    ]);
    expect(orderPair(out, out)).toEqual([{ field: "counterpartId", issue: "invalid" }]);
  });

  it("FIN-03@PoC FR 8: in one currency the credit may not exceed the debit — the difference is a fee, never a gain", () => {
    expect(orderPair(out, side(into.id, B, "500.01"))).toEqual([
      { field: "counterpartId", issue: "amount_mismatch" },
    ]);
    const usd = side(into.id, B, "600.00", { amount: Money.of("600.00", "USD") });
    expect(orderPair(out, usd)).toEqual({ outflow: out, inflow: usd });
  });

  it("FIN-03@PoC FR 18: a hidden, split, pending side or one already in a transfer cannot be marked", () => {
    const link = { id: A, outflowId: A, inflowId: B, rate: null };
    expect(orderPair(side(out.id, A, "-500.00", { hidden: true }), into)).toEqual([
      { field: "transactionId", issue: "hidden" },
    ]);
    expect(orderPair(out, side(into.id, B, "498.00", { split: {} }))).toEqual([
      { field: "counterpartId", issue: "split" },
    ]);
    expect(orderPair(out, side(into.id, B, "498.00", { status: "pending" }))).toEqual([
      { field: "counterpartId", issue: "pending" },
    ]);
    expect(orderPair(side(out.id, A, "-500.00", { transfer: link }), into)).toEqual([
      { field: "transactionId", issue: "in_transfer" },
    ]);
  });
});

describe("FIN-03@PoC FR 8, edge case 1: the fee, the rate and the date of a transfer", () => {
  it("FIN-03@PoC AC3: −500 EUR / +498 EUR — the fee is −2 EUR; equal amounts have none", () => {
    expect(transferFee(out, into)?.toDecimalString()).toBe("-2");
    expect(transferFee(out, side(into.id, B, "500.00"))).toBeNull();
  });

  it("FIN-03@PoC FR 8: in two currencies there is no fee; the rate is the inflow's currency in the outflow's on the earlier date", () => {
    const uah = side(into.id, B, "42900.00", { amount: Money.of("42900.00", "UAH"), date: "2026-10-12" });
    expect(transferFee(out, uah)).toBeNull();
    expect(transferRateRequest(out, uah)).toEqual({ from: "UAH", to: "EUR", date: "2026-10-12" });
    expect(transferRateRequest(out, into)).toBeNull();
  });

  it("FIN-03@PoC EC1: the transfer is dated by its earlier side", () => {
    expect(transferDate(out, into)).toBe("2026-10-13");
    expect(transferDate({ date: "2026-10-16" }, { date: "2026-10-14" })).toBe("2026-10-14");
  });
});
