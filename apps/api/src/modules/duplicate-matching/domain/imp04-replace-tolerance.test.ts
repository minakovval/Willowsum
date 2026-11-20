import { Decimal, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  planBatch,
  REPLACE_TOLERANCE,
  REPLACE_TOLERANCE_SHARE,
  replaceTolerance,
  type IncomingRow,
  type KnownTransaction,
} from "./index.ts";

/**
 * IMP-04@PoC FR 6, Рішення власника (2026-11-20), п. 8: a posted row replaces a pending one of a previous import when
 * their amounts are at most min(0,25; 10 % of the posted amount) apart in the account's currency — exact decimals —
 * with the same sign, on the pending date or up to 10 days after it (#638). Synthetic rows and ids only.
 */
const ACCOUNT = "acc-1";
const BATCH = "batch-new";
const EUR = (a: string) => Money.of(a, "EUR");

let nextRow = 1;
const posted = (amount: string, date = "2026-05-04"): IncomingRow => ({
  row: nextRow++,
  date,
  amount: EUR(amount),
  description: "SHOP",
  balance: null,
  status: "posted",
});

let nextTx = 1;
const pending = (amount: string, date = "2026-05-01"): KnownTransaction => ({
  transactionId: `t${String(nextTx++).padStart(4, "0")}`,
  accountId: ACCOUNT,
  amount: EUR(amount),
  date,
  description: "HOLD SHOP",
  balanceAfter: null,
  status: "pending",
  source: "imported",
  importBatchId: "batch-old",
  hidden: false,
  transfer: false,
  matched: false,
});

/** Whether the posted row replaces the pending one. */
const replaces = (row: IncomingRow, hold: KnownTransaction): boolean => {
  const [out] = planBatch({
    batchId: BATCH,
    accountId: ACCOUNT,
    rows: [row],
    existing: [hold],
    sameFileAppliedIn: null,
  });
  return out!.kind === "replace" && out!.replaces === hold.transactionId;
};

describe("IMP-04@PoC FR 6: the tolerance is min(0,25; 10 % of the amount)", () => {
  it("IMP-04@PoC FR 6: the tolerance is 0,25 capped by 10 % of the posted amount, exact", () => {
    expect(REPLACE_TOLERANCE).toBe("0.25");
    expect(REPLACE_TOLERANCE_SHARE).toBe("0.1");
    expect(replaceTolerance(new Decimal("-1.10")).toString()).toBe("0.11");
    expect(replaceTolerance(new Decimal("0.333")).toString()).toBe("0.0333");
    expect(replaceTolerance(new Decimal("-2.50")).toString()).toBe("0.25");
    expect(replaceTolerance(new Decimal("-123456789012345678.99")).toString()).toBe("0.25");
    expect(replaceTolerance(new Decimal("0")).toString()).toBe("0");
  });

  it("IMP-04@PoC FR 6: below 2,50 a small amount is replaced only within 10 % of it — the bound is in", () => {
    // −1,10: the tolerance is 0,11.
    expect(replaces(posted("-1.10"), pending("-1.00"))).toBe(true);
    expect(replaces(posted("-1.10"), pending("-0.99"))).toBe(true);
    expect(replaces(posted("-1.10"), pending("-0.989"))).toBe(false);
    expect(replaces(posted("-1.10"), pending("-1.211"))).toBe(false);
    // Under the old fixed 0,25 a pending −1,00 was replaced by a posted −1,20; now it is not (0,12).
    expect(replaces(posted("-1.20"), pending("-1.00"))).toBe(false);
    expect(replaces(posted("-2.23"), pending("-2.00"))).toBe(false);
    expect(replaces(posted("-2.20"), pending("-2.00"))).toBe(true);
  });

  it("IMP-04@PoC FR 6: from 2,50 up the cap 0,25 holds — 0,25 is in, more is out", () => {
    expect(replaces(posted("-2.50"), pending("-2.25"))).toBe(true);
    expect(replaces(posted("-2.50"), pending("-2.24"))).toBe(false);
    expect(replaces(posted("-10.00"), pending("-9.75"))).toBe(true);
    expect(replaces(posted("-10.00"), pending("-10.25"))).toBe(true);
    expect(replaces(posted("-10.00"), pending("-9.74"))).toBe(false);
    expect(replaces(posted("-10.00"), pending("-10.26"))).toBe(false);
  });

  it("IMP-04@PoC FR 6: the share is of the posted amount, not of the pending one", () => {
    // Posted −1,00: 0,10; pending −0,905 is 0,095 away (10 % of the pending one would be 0,0905).
    expect(replaces(posted("-1.00"), pending("-0.905"))).toBe(true);
    // Posted −0,905: 0,0905; pending −1,00 is 0,095 away (10 % of the pending one would be 0,10).
    expect(replaces(posted("-0.905"), pending("-1.00"))).toBe(false);
  });

  it("IMP-04@PoC FR 6: the same sign and the window [pending; +10 days] still hold with the new tolerance", () => {
    expect(replaces(posted("1.05"), pending("1.00"))).toBe(true);
    expect(replaces(posted("0.05"), pending("-0.05"))).toBe(false);
    expect(replaces(posted("-0.05"), pending("0.05"))).toBe(false);
    expect(replaces(posted("-1.05", "2026-05-11"), pending("-1.00"))).toBe(true);
    expect(replaces(posted("-1.05", "2026-05-12"), pending("-1.00"))).toBe(false);
    expect(replaces(posted("-1.05", "2026-04-30"), pending("-1.00"))).toBe(false);
    // A posted zero has no tolerance: only a pending zero is its row.
    expect(replaces(posted("0.00"), pending("0.01"))).toBe(false);
  });
});
