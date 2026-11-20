import { describe, expect, it } from "vitest";
import { rollbackBatch, rollbackUntil, type RollbackPorts, type StoredRollback } from "./rollback.ts";

/**
 * Security review of PR #666 (IMP-16@PoC FR 1, FR 3, FR 9; IMP-04@PoC AC8): the 7 days to the millisecond on the
 * server's clock, the batch's state, once, and the audit entry — against ports in memory. Synthetic data.
 */
const BATCH = "00000000-0000-4000-8000-0000000000b0";
const ACTOR = "00000000-0000-4000-8000-0000000000c1";
const APPLIED = new Date("2026-11-20T10:00:00Z");
const COUNTS = { rolledBack: 3, kept: 1, transfers: 0, restored: 2 };

function world(options: {
  state?: string;
  inProgress?: boolean;
  nowMs: number;
  doneInTransactions?: boolean;
}) {
  let state = options.state ?? "applied";
  let stored: StoredRollback | null = null;
  const rollbacks: unknown[] = [];
  const audit: { changes: { field: string; after: string | null }[]; actorAccountId: string }[] = [];
  const tx = {
    lockBatch: async () => ({ id: BATCH, state }),
    rollbackOf: async () => stored,
    application: async () => ({ appliedAt: APPLIED, inProgress: options.inProgress ?? false }),
    reviews: async () => [{ accountId: "a2" }, { accountId: "a1" }, { accountId: null }, { accountId: "a1" }],
    recordRollback: async (_b: string, r: StoredRollback) => void (stored = r),
    updateBatch: async (_b: string, next: string) => void (state = next),
    enqueueHandOff: async (h: (typeof audit)[number]) => void audit.push(h),
  };
  const ports: RollbackPorts = {
    run: (work) => work(tx as never),
    rollback: async (input) => {
      rollbacks.push(input);
      return {
        first: true,
        mode: input.mode,
        rolledBackBy: input.actorId,
        rolledBackAt: new Date(options.nowMs),
        counts: COUNTS,
        kept: ["k"],
      };
    },
    rolledBack: async () =>
      options.doneInTransactions
        ? { mode: "keep-changed", rolledBackBy: ACTOR, rolledBackAt: APPLIED, counts: COUNTS, kept: ["k"] }
        : null,
  };
  let n = 0;
  const deps = { now: () => new Date(options.nowMs), newId: () => `change-${++n}` };
  const run = (mode: "keep-changed" | "all" = "keep-changed") =>
    rollbackBatch(deps as never, ports, ACTOR, BATCH, mode);
  return { run, rollbacks, audit, state: () => state, stored: () => stored };
}

describe("IMP-16@PoC FR 1: the 7 days on the server's clock (security review of PR 666)", () => {
  const until = rollbackUntil(APPLIED).getTime();

  it("IMP-16@PoC FR 1: 7 days are exactly 604 800 000 ms after the apply, whatever the time zone or a change of the clocks", () => {
    expect(until - APPLIED.getTime()).toBe(604_800_000);
    // Across the end of summer time in Europe (2026-10-25) the 7 days are still 168 hours.
    expect(rollbackUntil(new Date("2026-10-22T10:00:00+02:00")).toISOString()).toBe(
      "2026-10-29T08:00:00.000Z",
    );
  });

  it("IMP-04@PoC AC8: at exactly 7 days the batch is rolled back; one millisecond later it is refused and module transactions is never called", async () => {
    const onTime = world({ nowMs: until });
    await expect(onTime.run()).resolves.toMatchObject({ result: { first: true } });
    expect(onTime.rollbacks).toHaveLength(1);
    const late = world({ nowMs: until + 1 });
    await expect(late.run("all")).rejects.toMatchObject({ name: "RollbackExpired" });
    expect([late.rollbacks.length, late.state(), late.stored(), late.audit.length]).toEqual([
      0,
      "applied",
      null,
      0,
    ]);
  });

  it("IMP-16@PoC FR 3: past 7 days only a rollback module transactions has already done is finished — it is not run again", async () => {
    const w = world({ nowMs: until + 86_400_000, doneInTransactions: true });
    await expect(w.run()).resolves.toMatchObject({ result: { first: true, rollback: { counts: COUNTS } } });
    expect(w.rollbacks).toHaveLength(0);
    expect(w.state()).toBe("rolled-back");
  });
});

describe("IMP-16@PoC FR 1, FR 3, FR 9: the batch's state, once, the audit entry (security review of PR 666)", () => {
  it.each(["uploaded", "parsed", "cancelled"])(
    "IMP-16@PoC FR 1: a batch «%s» is refused and module transactions is never called",
    async (state) => {
      const w = world({ state, nowMs: APPLIED.getTime() });
      await expect(w.run()).rejects.toMatchObject({ name: "BatchStateErrorFor" });
      expect(w.rollbacks).toHaveLength(0);
    },
  );

  it("IMP-16@PoC FR 1: a batch whose apply is still in progress is refused", async () => {
    const w = world({ inProgress: true, nowMs: APPLIED.getTime() });
    await expect(w.run()).rejects.toMatchObject({ name: "BatchStateErrorFor" });
    expect(w.rollbacks).toHaveLength(0);
  });

  it("IMP-16@PoC FR 3, FR 9: the first rollback writes the state, the result and the audit entries of its actor; the second writes nothing", async () => {
    const w = world({ nowMs: APPLIED.getTime() + 1 });
    const first = await w.run("all");
    expect(first.result).toMatchObject({
      first: true,
      rollback: { mode: "all", rolledBackBy: ACTOR, counts: COUNTS },
    });
    expect(w.rollbacks).toEqual([{ batchId: BATCH, actorId: ACTOR, accountIds: ["a2", "a1"], mode: "all" }]);
    expect(w.state()).toBe("rolled-back");
    const changes = w.audit.flatMap((a) => a.changes.map((c) => [c.field, c.after]));
    expect(changes).toEqual([
      ["state", "rolled-back"],
      ["rollback.mode", "all"],
      ["rollback.rolledBack", "3"],
      ["rollback.kept", "1"],
      ["rollback.transfers", "0"],
      ["rollback.restored", "2"],
    ]);
    expect(w.audit.every((a) => a.actorAccountId === ACTOR)).toBe(true);
    const again = await w.run("keep-changed");
    expect(again).toMatchObject({ result: { first: false, rollback: { mode: "all" } }, handOffs: [] });
    expect(w.rollbacks).toHaveLength(1);
    expect(w.audit).toHaveLength(2);
  });
});
