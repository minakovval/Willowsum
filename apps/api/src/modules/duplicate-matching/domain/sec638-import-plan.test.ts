import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { planImport, type PlanDeps } from "../application/index.ts";
import { planBatch, type IncomingRow, type KnownTransaction } from "./index.ts";

/**
 * Security review of PR #638 (IMP-04@PoC a): money integrity and resource bounds of the plan of an import batch.
 * Synthetic rows and ids only; amounts are exact decimals (Money).
 */
const ACCOUNT = "acc-1";
const BATCH = "batch-new";
const EUR = (a: string) => Money.of(a, "EUR");

const row = (n: number, over: Partial<IncomingRow> & { amount: Money; date: string }): IncomingRow => ({
  row: n,
  description: null,
  balance: null,
  status: "posted",
  ...over,
});

let nextTx = 1;
const tx = (over: Partial<KnownTransaction> & { amount: Money; date: string }): KnownTransaction => ({
  transactionId: `t${String(nextTx++).padStart(6, "0")}`,
  accountId: ACCOUNT,
  description: null,
  balanceAfter: null,
  status: "posted",
  source: "imported",
  importBatchId: "batch-old",
  hidden: false,
  transfer: false,
  matched: false,
  ...over,
});

const plan = (rows: readonly IncomingRow[], existing: readonly KnownTransaction[]) =>
  planBatch({ batchId: BATCH, accountId: ACCOUNT, rows, existing, sameFileAppliedIn: null });

describe("IMP-04@PoC FR 6: «замінено» never crosses the direction of the amount", () => {
  // Defect on 2fc1d539: |−0,10 − (+0,10)| = 0,20 ≤ 0,25, so a credit replaces a pending debit. With the patch
  // (import-plan.patch) this is a plain `it`.
  it("IMP-04@PoC FR 6: a posted credit +0,10 EUR does not replace a pending debit −0,10 EUR of a previous import", () => {
    const pending = tx({ amount: EUR("-0.10"), date: "2026-05-04", status: "pending", description: "fee" });
    const out = plan([row(1, { amount: EUR("0.10"), date: "2026-05-05", description: "refund" })], [pending]);
    expect(out.map((o) => o.kind)).toEqual(["import"]);
  });
});

describe("IMP-04@PoC FR 5: imported transactions of the batch itself", () => {
  it("IMP-04@PoC FR 5: an imported transaction of the same batch (another description, ± 3 days) is no «Можливий дубль» of a row", () => {
    const own = tx({
      amount: EUR("-25.00"),
      date: "2026-05-10",
      description: "CARD 4411",
      importBatchId: BATCH,
    });
    const out = plan(
      [row(1, { amount: EUR("-25.00"), date: "2026-05-12", description: "SHOP ONLINE" })],
      [own],
    );
    expect(out.map((o) => o.kind)).toEqual(["import"]);
  });
});

describe("IMP-04@PoC FR 1: the plan reads only the caller's space", () => {
  it("IMP-04@PoC FR 1: every page is asked for the caller's space and account", async () => {
    const asked: { householdId: string; accountId: string }[] = [];
    const deps: PlanDeps = {
      candidates: {
        page: async (householdId, query) => {
          asked.push({ householdId, accountId: query.accountId });
          return [];
        },
      },
    };
    await planImport(deps, "space-1", {
      batchId: BATCH,
      accountId: ACCOUNT,
      rows: [row(1, { amount: EUR("-1"), date: "2026-05-04" })],
      sameFileAppliedIn: null,
    });
    expect(asked).toEqual([{ householdId: "space-1", accountId: ACCOUNT }]);
  });
});

describe("IMP-04@PoC a): the plan is bounded in time on a full window", () => {
  // Defect on 2fc1d539: every row that is no key duplicate scans all the transactions twice (FR 6, FR 5), and the
  // key index copies its list on every insert. Measured: 1 000 rows × 50 000 ≈ 23 s, 20 000 × 50 000 ≈ 425 s of one
  // synchronous call; 50 000 transactions of one key ≈ 12 s. With the patch: 20 000 × 50 000 ≈ 0,6 s. With the patch
  // these are plain `it`.
  it("IMP-04@PoC a): 1 000 rows against the 50 000 transactions the window allows are planned within 3 s", () => {
    const existing = Array.from({ length: 50_000 }, (_, i) =>
      tx({
        amount: EUR(`-${(i % 500) + 1}.37`),
        date: `2026-0${1 + (i % 9)}-1${i % 10}`,
        description: `e ${i}`,
      }),
    );
    const rows = Array.from({ length: 1_000 }, (_, i) =>
      row(i + 1, {
        amount: EUR(`-${(i % 500) + 1000}.11`),
        date: `2026-0${1 + (i % 9)}-1${i % 10}`,
        description: `r ${i}`,
      }),
    );
    const started = performance.now();
    expect(plan(rows, existing)).toHaveLength(1_000);
    expect(performance.now() - started).toBeLessThan(3_000);
  }, 120_000);

  it("IMP-04@PoC a): 50 000 transactions of one key are indexed within 3 s", () => {
    const existing = Array.from({ length: 50_000 }, () => tx({ amount: EUR("-1"), date: "2026-01-01" }));
    const started = performance.now();
    expect(plan([row(1, { amount: EUR("-5"), date: "2026-03-01" })], existing)).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(3_000);
  }, 120_000);
});
