import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import type { IncomingRow, KnownTransaction } from "../domain/index.ts";
import { PLAN_EXISTING_MAX, PLAN_PAGE, planImport, PlanTooLargeError, type PlanDeps } from "./index.ts";

/** IMP-04@PoC a): the plan reads the account's window page by page through the transactions port. Synthetic data. */
const row = (n: number, date: string): IncomingRow => ({
  row: n,
  date,
  amount: Money.of("-1.00", "EUR"),
  description: "x",
  balance: null,
  status: "posted",
});
const known = (i: number): KnownTransaction => ({
  transactionId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  accountId: "acc",
  amount: Money.of("-1.00", "EUR"),
  date: "2026-05-04",
  description: "x",
  balanceAfter: null,
  status: "posted",
  source: "imported",
  importBatchId: "old",
  hidden: false,
  transfer: false,
  matched: false,
});

function port(total: number) {
  const all = Array.from({ length: total }, (_, i) => known(i));
  const calls: Parameters<PlanDeps["candidates"]["page"]>[1][] = [];
  const deps: PlanDeps = {
    candidates: {
      async page(_h, query) {
        calls.push(query);
        const start = query.after ? all.findIndex((t) => t.transactionId === query.after!.id) + 1 : 0;
        return all.slice(start, start + query.limit);
      },
    },
  };
  return { deps, calls };
}

describe("IMP-04@PoC FR 1: the plan reads the account's window through transactions' `ImportCandidates`", () => {
  it("IMP-04@PoC FR 1: pages of PLAN_PAGE after the last (date, id), in the rows' dates ± 10 days", async () => {
    const { deps, calls } = port(PLAN_PAGE + 5);
    const out = await planImport(deps, "h", {
      batchId: "new",
      accountId: "acc",
      rows: [row(1, "2026-05-04"), row(2, "2026-05-06")],
      sameFileAppliedIn: null,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ accountId: "acc", from: "2026-04-24", to: "2026-05-16", limit: PLAN_PAGE });
    expect(calls[1]!.after).toEqual({ date: "2026-05-04", id: known(PLAN_PAGE - 1).transactionId });
    // The second row is two days later: not the key, but within 3 days of imported ones — «Можливий дубль».
    expect(out.map((o) => o.kind)).toEqual(["duplicate", "possible-duplicate"]);
  });

  it("IMP-04@PoC FR 3: the same file applied — nothing is read", async () => {
    const { deps, calls } = port(3);
    const out = await planImport(deps, "h", {
      batchId: "new",
      accountId: "acc",
      rows: [row(1, "2026-05-04")],
      sameFileAppliedIn: "old",
    });
    expect(calls).toHaveLength(0);
    expect(out[0]!.kind).toBe("already-imported");
  });

  it("IMP-04@PoC FR 1: more than PLAN_EXISTING_MAX transactions in the window — refused, nothing planned", async () => {
    const { deps } = port(PLAN_EXISTING_MAX + PLAN_PAGE);
    await expect(
      planImport(deps, "h", {
        batchId: "new",
        accountId: "acc",
        rows: [row(1, "2026-05-04")],
        sameFileAppliedIn: null,
      }),
    ).rejects.toBeInstanceOf(PlanTooLargeError);
  });
});
