import { describe, expect, it } from "vitest";
import { DEADLOCK_RETRIES, dailyCleanup } from "./maintenance.ts";
import type { IdentityStore, IdentityTx, SweepCounts } from "./ports.ts";

/**
 * Security review of PR #100, non-blocking item 2: the task and a confirmation lock the account and its link in
 * opposite orders, so PostgreSQL may abort the task's transaction as a deadlock victim (SQLSTATE 40P01). The task
 * retries that transaction instead of skipping the batch and the sweep until the next day.
 */
const SWEPT: SweepCounts = {
  throttleEvents: 0,
  signInGuards: 0,
  registrations: 0,
  emailConfirmations: 0,
  passwordResets: 0,
  sessions: 0,
  notMeLinks: 0,
};
const deadlock = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });

function fakeStore(failures: { delete: unknown[]; sweep: unknown[] }) {
  const calls = { delete: 0, sweep: 0 };
  const tx = {
    deleteUnconfirmedAccounts: async () => {
      calls.delete++;
      const failure = failures.delete.shift();
      if (failure) throw failure;
      return ["00000000-0000-4000-8000-000000000001"];
    },
    sweep: async () => {
      calls.sweep++;
      const failure = failures.sweep.shift();
      if (failure) throw failure;
      return SWEPT;
    },
  } as unknown as IdentityTx;
  const store: IdentityStore = { transaction: (work) => work(tx) };
  return { store, calls };
}

function run(store: IdentityStore, audited: string[] = []) {
  return dailyCleanup({
    store,
    now: () => Date.UTC(2026, 10, 12),
    audit: { accountDeleted: async (id: string) => void audited.push(id) },
  });
}

describe("dailyCleanup: a deadlock victim is retried", () => {
  it("a batch and the sweep aborted with 40P01 are run again, and every deleted account is audited once", async () => {
    const { store, calls } = fakeStore({ delete: [deadlock()], sweep: [deadlock(), deadlock()] });
    const audited: string[] = [];
    const report = await run(store, audited);
    expect(report.unconfirmedAccounts).toBe(1);
    expect(audited).toHaveLength(1);
    expect(calls).toEqual({ delete: 2, sweep: 3 });
  });

  it(`gives up after ${DEADLOCK_RETRIES} retries and reports the deadlock`, async () => {
    const { store, calls } = fakeStore({
      delete: Array.from({ length: DEADLOCK_RETRIES + 1 }, deadlock),
      sweep: [],
    });
    await expect(run(store)).rejects.toMatchObject({ code: "40P01" });
    expect(calls.delete).toBe(DEADLOCK_RETRIES + 1);
    expect(calls.sweep).toBe(0);
  });

  it("any other error is not retried", async () => {
    const other = Object.assign(new Error("serialization failure"), { code: "40001" });
    const { store, calls } = fakeStore({ delete: [other], sweep: [] });
    await expect(run(store)).rejects.toBe(other);
    expect(calls.delete).toBe(1);
  });
});
