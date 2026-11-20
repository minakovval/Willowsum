import { describe, expect, it } from "vitest";
import {
  ROLLBACK_DAYS,
  ROLLBACK_RECOVERY_DAYS,
  ROLLBACK_STUCK_AFTER_MS,
  recoverStuckRollbacks,
  rollbackBatch,
  rollbackUntil,
  type RollbackPorts,
  type StoredRollback,
  type TransactionsRollback,
} from "./rollback.ts";

/** IMP-16@PoC FR 1, FR 3, FR 9 (wave 2 row 44): the 7 days, and a rollback finished after a crash. Synthetic data. */
const FIRST_ACTOR = "00000000-0000-4000-8000-0000000000c1";
const RETRY_ACTOR = "00000000-0000-4000-8000-0000000000c2";
const APPLIED = new Date("2026-11-20T10:00:00Z");
const DONE_AT = new Date("2026-11-21T10:00:00Z");
const COUNTS = { rolledBack: 2, kept: 0, transfers: 0, restored: 0 };

const recorded = (batchId: string): TransactionsRollback & { batchId: string } => ({
  batchId,
  mode: "all",
  rolledBackBy: FIRST_ACTOR,
  rolledBackAt: DONE_AT,
  counts: COUNTS,
  kept: [],
});

/** Batches of this module in memory; module transactions rolled back `done` already (its step B). */
function world(states: Record<string, string>, nowMs: number) {
  const stored = new Map<string, StoredRollback>();
  const audit: {
    entityId: string;
    actorAccountId: string;
    changes: { field: string; after: string | null }[];
  }[] = [];
  let current = "";
  const tx = {
    lockBatch: async (id: string) => (id in states ? ((current = id), { id, state: states[id] }) : null),
    rollbackOf: async (id: string) => stored.get(id) ?? null,
    application: async () => ({ appliedAt: APPLIED, inProgress: false }),
    reviews: async () => [{ accountId: "a1" }],
    recordRollback: async (id: string, r: StoredRollback) => void stored.set(id, r),
    updateBatch: async (id: string, next: string) => void (states[id] = next),
    enqueueHandOff: async (h: (typeof audit)[number]) => void audit.push(h),
  };
  const run: RollbackPorts["run"] = (work) => work(tx as never);
  let n = 0;
  const deps = { now: () => new Date(nowMs), newId: () => `change-${++n}` } as never;
  return { run, deps, audit, stored, states, current: () => current };
}

describe("IMP-16@PoC FR 1: the rollback's 7 days", () => {
  it("IMP-16@PoC FR 1: until exactly 7 days after the apply finished", () => {
    expect(ROLLBACK_DAYS).toBe(7);
    expect(rollbackUntil(new Date("2026-11-20T10:00:00Z")).toISOString()).toBe("2026-11-27T10:00:00.000Z");
  });
});

describe("IMP-16@PoC FR 3, FR 9: a rollback finished after its request ended", () => {
  it("IMP-16@PoC FR 3, FR 9: a retry with another mode by another person records and audits the first request's mode, actor and time", async () => {
    const w = world({ b1: "applied" }, DONE_AT.getTime() + 60_000);
    const ports: RollbackPorts = {
      run: w.run,
      rollback: async () => ({ first: false, ...recorded("b1") }),
      rolledBack: async () => recorded("b1"),
    };
    const out = await rollbackBatch(w.deps, ports, RETRY_ACTOR, "b1", "keep-changed");
    expect(out.result.rollback).toEqual({
      mode: "all",
      rolledBackBy: FIRST_ACTOR,
      rolledBackAt: DONE_AT,
      counts: COUNTS,
      kept: [],
    });
    expect(w.stored.get("b1")?.mode).toBe("all");
    expect(w.audit.every((a) => a.actorAccountId === FIRST_ACTOR)).toBe(true);
    expect(w.audit.flatMap((a) => a.changes).find((c) => c.field === "rollback.mode")?.after).toBe("all");
  });

  it("IMP-16@PoC FR 3, FR 9: the recovery finishes only batches still «застосовано», each once; one no longer here is skipped", async () => {
    const now = DONE_AT.getTime() + 3_600_000;
    const w = world({ b1: "applied", b2: "rolled-back" }, now);
    w.stored.set("b2", { ...recorded("b2"), counts: { ...COUNTS } });
    const asked: [Date, Date][] = [];
    const since = async (from: Date, before: Date) => {
      asked.push([from, before]);
      return [recorded("b1"), recorded("b2"), recorded("gone")];
    };
    const first = await recoverStuckRollbacks(w.deps, w.run, since);
    expect(first.result).toEqual({ finished: 1, failed: 0 });
    expect(w.states.b1).toBe("rolled-back");
    expect(first.handOffs.map((h) => h.entityId)).toEqual(["b1", "b1"]);
    expect(first.handOffs.every((h) => h.actorAccountId === FIRST_ACTOR)).toBe(true);
    expect(asked[0]).toEqual([
      new Date(now - ROLLBACK_RECOVERY_DAYS * 24 * 60 * 60 * 1000),
      new Date(now - ROLLBACK_STUCK_AFTER_MS),
    ]);
    const again = await recoverStuckRollbacks(w.deps, w.run, since);
    expect(again.result).toEqual({ finished: 0, failed: 0 });
    expect(again.handOffs).toEqual([]);
  });

  it("IMP-16@PoC FR 3: a batch in another state is counted as failed, never changed", async () => {
    const w = world({ b1: "cancelled" }, DONE_AT.getTime() + 3_600_000);
    const out = await recoverStuckRollbacks(w.deps, w.run, async () => [recorded("b1")]);
    expect(out.result).toEqual({ finished: 0, failed: 1 });
    expect(w.states.b1).toBe("cancelled");
    expect(w.audit).toEqual([]);
  });
});
