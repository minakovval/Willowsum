import { Decimal, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { planBatch, replaceTolerance, type IncomingRow, type KnownTransaction } from "./index.ts";

/**
 * Security review of #643 (IMP-04@PoC FR 6, the tolerance min(0,25; 10 % of the posted amount)): a posted row never
 * replaces a pending transaction the rule does not name. Synthetic rows and ids only.
 */
const EUR = (a: string) => Money.of(a, "EUR");
const posted = (amount: string, row = 1): IncomingRow => ({
  row,
  date: "2026-05-04",
  amount: EUR(amount),
  description: "SHOP",
  balance: null,
  status: "posted",
});
const pending = (id: string, amount: string, date = "2026-05-01"): KnownTransaction => ({
  transactionId: id,
  accountId: "acc-1",
  amount: EUR(amount),
  date,
  description: "HOLD",
  balanceAfter: null,
  status: "pending",
  source: "imported",
  importBatchId: "batch-old",
  hidden: false,
  transfer: false,
  matched: false,
});
const plan = (rows: readonly IncomingRow[], existing: readonly KnownTransaction[]) =>
  planBatch({ batchId: "batch-new", accountId: "acc-1", rows, existing, sameFileAppliedIn: null });

describe("sec643: the pending→posted tolerance never widens what a posted row replaces", () => {
  it("sec643 IMP-04@PoC FR 6: the tolerance is never above 0,25 nor above a tenth of the amount, for either sign, zero and amounts of any size — exact", () => {
    for (const text of [
      "0",
      "0.00",
      "0.000000000000000001",
      "0.01",
      "0.09",
      "1",
      "2.49",
      "2.499999999999999999",
      "2.5",
      "2.500000000000000001",
      "1000000",
      "99999999999999999999.999999999999999999",
    ])
      for (const sign of ["", "-"]) {
        const amount = new Decimal(sign + text);
        const tolerance = replaceTolerance(amount);
        expect(tolerance.isNegative() && !tolerance.isZero()).toBe(false);
        expect(tolerance.lte("0.25")).toBe(true);
        // Exactly a tenth, never rounded: ten tolerances are the amount again below the cap.
        if (amount.abs().lt("2.5")) expect(tolerance.times(10).eq(amount.abs())).toBe(true);
        else expect(tolerance.eq("0.25")).toBe(true);
      }
  });

  it("sec643 IMP-04@PoC FR 6: a posted row of zero replaces only a pending zero; a small posted row never replaces a pending one of another sign or of zero", () => {
    const kind = (row: string, hold: string) => plan([posted(row)], [pending("t1", hold)])[0]!.kind;
    expect(kind("0.00", "0.00")).toBe("replace");
    for (const hold of ["0.01", "-0.01", "0.25", "-0.25"]) expect(kind("0.00", hold)).not.toBe("replace");
    for (const [row, hold] of [
      ["0.10", "-0.10"],
      ["-0.10", "0.10"],
      ["0.01", "-0.01"],
      ["-0.12", "0.12"],
      ["0.10", "0.00"],
      ["-0.10", "0.00"],
      ["0.20", "0.00"],
    ] as const)
      expect(kind(row, hold), `${row} / ${hold}`).not.toBe("replace");
  });

  it("sec643 IMP-04@PoC FR 6: among pending ones a small posted row takes the one within a tenth of it, never a closer-dated one outside it", () => {
    // 1,00 posted: 0,90 is within 0,10; 0,80 and 1,25 (both within the old 0,25) are not.
    const out = plan(
      [posted("-1.00")],
      [
        pending("t-far", "-0.80", "2026-05-04"),
        pending("t-in", "-0.90", "2026-04-24"),
        pending("t-over", "-1.25", "2026-05-04"),
      ],
    );
    expect(out[0]).toMatchObject({ kind: "replace", replaces: "t-in" });
    // Two posted rows, one pending one within both: it is replaced once.
    const twice = plan([posted("-1.00", 1), posted("-1.00", 2)], [pending("t-in", "-0.95")]);
    expect(twice.filter((o) => o.kind === "replace")).toHaveLength(1);
  });
});
