import { describe, expect, it } from "vitest";
import { Money } from "@willowsum/domain-kernel";
import { transactionAuditValues } from "./hand-off.ts";
import type { StoredTransaction } from "./stored.ts";
import { keepsOneOff } from "../domain/index.ts";

/** BUD-06@PoC FR 8 «Одноразова витрата»: the mark is a field of the transaction's audit entry («Права доступу»). */
const eur = (a: string) => Money.of(a, "EUR");

describe("BUD-06@PoC FR 8: «Одноразова витрата» in the audit log", () => {
  it("BUD-06@PoC FR 8: the mark is written to the audit log — `oneOff` «true» when set, null when taken off", () => {
    const before = {
      id: "t",
      accountId: "a",
      subaccountId: "s",
      amount: eur("-3500.00"),
      date: "2026-08-14",
      counterparty: null,
      description: null,
      status: "posted",
      source: "manual",
      hidden: false,
      split: null,
      transfer: null,
      mergedInto: null,
      note: null,
      tagIds: [],
      oneOff: false,
      review: null,
      version: 1,
      createdAt: "2026-08-14T10:00:00.000Z",
    } satisfies StoredTransaction;
    const after = { ...before, oneOff: true, version: 2 };
    expect(transactionAuditValues("update", before, after)).toEqual([
      { field: "oneOff", before: null, after: "true", sensitive: false },
    ]);
    expect(transactionAuditValues("update", after, before)).toEqual([
      { field: "oneOff", before: "true", after: null, sensitive: false },
    ]);
  });

  it("BUD-06@PoC FR 8: a row keeps the mark only as an expense that is no side of a transfer (#685)", () => {
    expect(keepsOneOff({ oneOff: true, amount: eur("-3500.00"), transfer: null })).toBe(true);
    expect(keepsOneOff({ oneOff: true, amount: eur("3500.00"), transfer: null })).toBe(false);
    expect(keepsOneOff({ oneOff: true, amount: eur("-300.00"), transfer: { id: "x" } })).toBe(false);
    expect(keepsOneOff({ oneOff: false, amount: eur("-3500.00"), transfer: null })).toBe(false);
  });
});
