import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { dismissalPair, dismissIssues, mergeIssues, type MergeSide } from "./duplicates.ts";

/** FIN-03@PoC b) (wave 2 row 16c): what «Об'єднати» and «Не дубль» accept, without I/O. */
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const SUB = "33333333-3333-4333-8333-333333333333";

function t(id: string, amount = "-30.00", extra: Partial<MergeSide> = {}): MergeSide {
  return {
    id,
    accountId: ACCOUNT,
    subaccountId: SUB,
    amount: Money.of(amount, "EUR"),
    status: "posted",
    hidden: false,
    transfer: null,
    mergedInto: null,
    ...extra,
  };
}

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("FIN-03@PoC FR 11, FR 27: «Об'єднати» — one operation entered twice", () => {
  it("FIN-03@PoC FR 11: two transactions on one account with the same amount and currency merge", () => {
    expect(mergeIssues(t(A), t(B), false)).toEqual([]);
  });

  it("FIN-03@PoC FR 11: another account, amount or currency, or the transaction itself is refused", () => {
    expect(mergeIssues(t(A), t(A), false)).toEqual([{ field: "duplicateId", issue: "invalid" }]);
    expect(mergeIssues(t(A), t(B, "-30.00", { accountId: B }), false)).toEqual([
      { field: "duplicateId", issue: "account_mismatch" },
    ]);
    expect(mergeIssues(t(A), t(B, "-30.50"), false)).toEqual([
      { field: "duplicateId", issue: "amount_mismatch" },
    ]);
    expect(
      mergeIssues(t(A), t(B, "-30.00", { subaccountId: B, amount: Money.of("-30", "USD") }), false),
    ).toEqual([{ field: "duplicateId", issue: "amount_mismatch" }]);
  });

  it("FIN-03@PoC FR 18: a side of a transfer, a hidden or merged one, or a duplicate others were merged into is refused", () => {
    const link = { id: A, outflowId: A, inflowId: B, rate: null };
    expect(mergeIssues(t(A, "-30.00", { transfer: link }), t(B), false)).toEqual([
      { field: "transactionId", issue: "in_transfer" },
    ]);
    expect(mergeIssues(t(A), t(B, "-30.00", { hidden: true }), false)).toEqual([
      { field: "duplicateId", issue: "hidden" },
    ]);
    expect(mergeIssues(t(A, "-30.00", { hidden: true, mergedInto: B }), t(B), false)).toEqual([
      { field: "transactionId", issue: "merged" },
    ]);
    expect(mergeIssues(t(A), t(B), true)).toEqual([{ field: "duplicateId", issue: "has_duplicates" }]);
  });

  it("FIN-03@PoC FR 11, FR 24: a posted duplicate is not merged into an «Очікує» one — the operation would leave the balance", () => {
    expect(mergeIssues(t(A, "-30.00", { status: "pending" }), t(B), false)).toEqual([
      { field: "transactionId", issue: "pending" },
    ]);
    expect(mergeIssues(t(A), t(B, "-30.00", { status: "pending" }), false)).toEqual([]);
    expect(
      mergeIssues(t(A, "-30.00", { status: "pending" }), t(B, "-30.00", { status: "pending" }), false),
    ).toEqual([]);
  });
});

describe("FIN-03@PoC FR 12: «Не дубль»", () => {
  it("FIN-03@PoC FR 12: only a pair that could be a duplicate; stored in the order of its ids", () => {
    expect(dismissIssues(t(A), t(B))).toEqual([]);
    expect(dismissIssues(t(A), t(A))).toEqual([{ field: "counterpartId", issue: "invalid" }]);
    expect(dismissIssues(t(A), t(B, "-1.00"))).toEqual([
      { field: "counterpartId", issue: "amount_mismatch" },
    ]);
    expect(dismissIssues(t(A), t(B, "-30.00", { accountId: B }))).toEqual([
      { field: "counterpartId", issue: "account_mismatch" },
    ]);
    expect(dismissalPair(B, A)).toEqual([A, B]);
    expect(dismissalPair(A, B)).toEqual([A, B]);
  });
});
