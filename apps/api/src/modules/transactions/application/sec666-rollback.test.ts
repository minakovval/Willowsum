import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import type { TransactionHandOff } from "./hand-off.ts";
import {
  rollbackImport,
  type ImportRollbackTx,
  type RollbackCategory,
  type RollbackMode,
  type RollbackRow,
} from "./rollback.ts";
import type { StoredTransaction } from "./stored.ts";

/**
 * Security review of PR #666 (IMP-16@PoC FR 2–5; IMP-04@PoC FR 8): the rollback of module transactions against a
 * store in memory — what is rolled back, kept and restored, once, in the lock order of the apply. Synthetic data.
 */
const H = "00000000-0000-4000-8000-0000000000aa";
const BATCH = "00000000-0000-4000-8000-0000000000b0";
const ACCOUNT = "00000000-0000-4000-8000-0000000000a1";
const OTHER_ACCOUNT = "00000000-0000-4000-8000-0000000000a2";
const ACTOR = "00000000-0000-4000-8000-0000000000c1";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const row = (n: number, over: Partial<RollbackRow> = {}): RollbackRow => ({
  id: id(n),
  accountId: ACCOUNT,
  subaccountId: "00000000-0000-4000-8000-0000000000b1",
  amount: Money.of("-30.00", "EUR"),
  date: "2026-04-13",
  counterparty: null,
  description: `SHOP ${n}`,
  status: "posted",
  source: "imported",
  hidden: false,
  split: null,
  transfer: null,
  mergedInto: null,
  note: null,
  tagIds: [],
  review: "queued",
  version: 1,
  createdAt: "2026-11-20T10:00:00.000Z",
  importBatchId: BATCH,
  rolledBack: false,
  ...over,
});

function store(
  rows: RollbackRow[],
  options: {
    closed?: boolean;
    categories?: [string, RollbackCategory][];
    mergedMeanwhile?: RollbackRow;
  } = {},
) {
  const all = new Map(rows.map((r) => [r.id, r]));
  const calls: string[] = [];
  const updates: StoredTransaction[] = [];
  const marked: string[] = [];
  const handOffs: TransactionHandOff[] = [];
  let recorded: { counts: Record<string, number>; kept: readonly string[] } | null = null;
  const tx: ImportRollbackTx = {
    enterImport: async () => (calls.push("enter"), true),
    lockImport: async (_h, ids) => void calls.push(`import:${ids.join(",")}`),
    lockAccounts: async (_h, ids) => void calls.push(`money:${ids.join(",")}`),
    rolledBackBatch: async () => recorded as never,
    rolledBackSince: async () => [],
    batchRows: async (_h, batchId) =>
      [...all.values()]
        .filter((r) => r.importBatchId === batchId)
        .map((r) => ({ id: r.id, accountId: r.accountId })),
    mergedInto: async (_h, ids) =>
      [...all.values()].filter((r) => r.mergedInto !== null && ids.includes(r.mergedInto)).map((r) => r.id),
    lockRows: async (_h, ids) => {
      calls.push(`rows:${ids.join(",")}`);
      const locked = ids.flatMap((i) => (all.has(i) ? [all.get(i)!] : []));
      // Another request merges a row into one of the batch's after the unlocked read.
      if (options.mergedMeanwhile) all.set(options.mergedMeanwhile.id, options.mergedMeanwhile);
      return locked;
    },
    update: async (_h, next) => {
      const before = all.get(next.id)!;
      const after = { ...before, ...next } as RollbackRow;
      all.set(next.id, after);
      updates.push(after);
      return after;
    },
    markRolledBack: async (_h, rowId) => {
      marked.push(rowId);
      all.set(rowId, { ...all.get(rowId)!, rolledBack: true });
    },
    enqueueHandOff: async (_h, h) => void handOffs.push(h),
    recordRollback: async (_h, _b, result) => {
      if (recorded) throw new Error("recorded twice");
      recorded = { counts: { ...result.counts }, kept: result.kept };
    },
  };
  const deps = {
    accounts: {
      postingAccount: async (_h: string, accountId: string) => ({
        accountId,
        kind: "current",
        status: options.closed ? "closed" : "active",
        subaccounts: [],
      }),
    },
    now: () => new Date("2026-11-22T10:00:00Z"),
    categories: async () => new Map(options.categories ?? []),
  };
  const run = (mode: RollbackMode = "keep-changed", accountIds: string[] = [ACCOUNT]) =>
    rollbackImport(deps as never, tx, H, { batchId: BATCH, actorId: ACTOR, accountIds, mode });
  return { all, calls, updates, marked, handOffs, run, recorded: () => recorded };
}

describe("IMP-16@PoC FR 2: each transaction of the batch is rolled back, never deleted (security review of PR 666)", () => {
  it("IMP-16@PoC FR 2: every row of the batch is hidden, marked rolled back and handed to the journal once; a row of no batch is not touched", async () => {
    const s = store([row(1), row(2), row(3, { importBatchId: null, source: "manual" })]);
    const result = await s.run();
    expect(result.first).toBe(true);
    expect(result.counts).toEqual({ rolledBack: 2, kept: 0, transfers: 0, restored: 0 });
    expect(s.marked).toEqual([id(1), id(2)]);
    expect(s.updates.map((u) => [u.id, u.hidden, u.mergedInto, u.version])).toEqual([
      [id(1), true, null, 2],
      [id(2), true, null, 2],
    ]);
    // The amount never changes: the journal reverses the entry it holds.
    expect(s.updates.every((u) => u.amount.equals(Money.of("-30.00", "EUR")))).toBe(true);
    expect(s.handOffs.map((h) => [h.transactionId, h.action, h.version, h.actorAccountId])).toEqual([
      [id(1), "rollback", 2, ACTOR],
      [id(2), "rollback", 2, ACTOR],
    ]);
    expect(s.all.get(id(3))).toMatchObject({ hidden: false, rolledBack: false, version: 1 });
    expect(s.all.size).toBe(3);
  });

  it("IMP-16@PoC FR 3: a second rollback changes nothing and returns the first one's result, whatever the choice", async () => {
    const s = store([row(1), row(2, { note: "Подарунок" })]);
    const first = await s.run("keep-changed");
    const writes = [s.updates.length, s.marked.length, s.handOffs.length];
    const again = await s.run("all");
    expect(again).toMatchObject({ first: false, counts: first.counts, kept: first.kept, handOffs: [] });
    expect([s.updates.length, s.marked.length, s.handOffs.length]).toEqual(writes);
  });

  it("IMP-16@PoC FR 3: the locks come in the order of the apply — the import lock on sorted accounts, the rows by id, then the money lock — before any write", async () => {
    const s = store([row(2, { accountId: OTHER_ACCOUNT }), row(1)]);
    await s.run("all", [OTHER_ACCOUNT]);
    expect(s.calls).toEqual([
      "enter",
      `import:${ACCOUNT},${OTHER_ACCOUNT}`,
      `rows:${id(1)},${id(2)}`,
      `money:${ACCOUNT},${OTHER_ACCOUNT}`,
    ]);
  });

  it("IMP-16@PoC FR 1: a closed account — refused before any write", async () => {
    const s = store([row(1)], { closed: true });
    await expect(s.run("all")).rejects.toMatchObject({ name: "ImportWriteRefused" });
    expect([s.updates.length, s.marked.length, s.handOffs.length, s.recorded()]).toEqual([0, 0, 0, null]);
  });
});

describe("IMP-16@PoC FR 4: «Залишити змінені» keeps only what the person changed (security review of PR 666)", () => {
  const rows = () => [row(1), row(2, { note: "Подарунок" }), row(3), row(4)];
  const categories: [string, RollbackCategory][] = [
    [id(3), { categoryId: "c", source: "manual" }],
    [id(4), { categoryId: "c", source: "rule" }],
  ];

  it("IMP-16@PoC FR 4: a note and a category set by hand are kept and named; a rule's category and an untouched row are rolled back", async () => {
    const s = store(rows(), { categories });
    const result = await s.run("keep-changed");
    expect(result.counts).toEqual({ rolledBack: 2, kept: 2, transfers: 0, restored: 0 });
    expect(result.kept).toEqual([id(2), id(3)]);
    expect(s.marked).toEqual([id(1), id(4)]);
    expect(s.all.get(id(2))).toMatchObject({ hidden: false, rolledBack: false, version: 1 });
  });

  it("IMP-16@PoC FR 4: «Відкотити все» keeps none of them", async () => {
    const s = store(rows(), { categories });
    const result = await s.run("all");
    expect(result.counts).toEqual({ rolledBack: 4, kept: 0, transfers: 0, restored: 0 });
    expect(s.marked).toEqual([id(1), id(2), id(3), id(4)]);
  });

  it("IMP-16@PoC FR 4: a transaction already rolled back is not rolled back or counted again", async () => {
    const s = store([row(1, { rolledBack: true, hidden: true }), row(2)]);
    const result = await s.run("all");
    expect(result.counts.rolledBack).toBe(1);
    expect(s.marked).toEqual([id(2)]);
  });
});

describe("IMP-16@PoC FR 5: what was merged into a rolled-back transaction comes back (security review of PR 666)", () => {
  const manual = (n: number, into: number, over: Partial<RollbackRow> = {}) =>
    row(n, { source: "manual", importBatchId: null, hidden: true, mergedInto: id(into), ...over });

  it("IMP-16@PoC FR 5: the merged one is shown and unmerged after its row is rolled back; one merged into a kept row stays merged", async () => {
    const s = store([row(1), row(2, { note: "Своя" }), manual(8, 1), manual(9, 2)]);
    const result = await s.run("keep-changed");
    expect(result.counts).toEqual({ rolledBack: 1, kept: 1, transfers: 0, restored: 1 });
    expect(s.all.get(id(8))).toMatchObject({
      hidden: false,
      mergedInto: null,
      version: 2,
      rolledBack: false,
    });
    expect(s.all.get(id(9))).toMatchObject({ hidden: true, mergedInto: id(2), version: 1 });
    // The rolled-back row's hand-off first, so the balance never counts both.
    expect(s.handOffs.map((h) => [h.transactionId, h.action])).toEqual([
      [id(1), "rollback"],
      [id(8), "unmerge"],
    ]);
    expect(s.marked).toEqual([id(1)]);
  });

  it("IMP-16@PoC FR 5: a merged transaction on an account outside the batch's locks — refused, nothing written", async () => {
    const s = store([row(1), manual(8, 1, { accountId: OTHER_ACCOUNT })]);
    await expect(s.run("all")).rejects.toMatchObject({
      name: "ImportWriteRefused",
      issue: "account-changed",
    });
    expect([s.updates.length, s.marked.length, s.handOffs.length, s.recorded()]).toEqual([0, 0, 0, null]);
  });

  it("IMP-16@PoC FR 5: a transaction merged into the batch's row while the rollback was taking its locks — try again, nothing written", async () => {
    const s = store([row(1)], { mergedMeanwhile: manual(8, 1) });
    await expect(s.run("all")).rejects.toMatchObject({ name: "ImportRollbackBusy" });
    expect([s.updates.length, s.marked.length, s.handOffs.length, s.recorded()]).toEqual([0, 0, 0, null]);
  });

  it("IMP-16@PoC FR 4: a side of a transfer is kept and counted as one, in either choice — its pair's journal event stays whole", async () => {
    const transfer = { id: id(70), inflowId: id(71), outflowId: id(1), rate: null } as never;
    for (const mode of ["keep-changed", "all"] as const) {
      const s = store([row(1, { transfer }), row(2)]);
      const result = await s.run(mode);
      expect(result.counts).toEqual({ rolledBack: 1, kept: 0, transfers: 1, restored: 0 });
      expect(result.kept).toEqual([id(1)]);
      expect(s.marked).toEqual([id(2)]);
      expect(s.all.get(id(1))).toMatchObject({ hidden: false, rolledBack: false, version: 1 });
    }
  });

  it("IMP-16@PoC FR 5: a merged transaction rolled back with its own batch does not come back", async () => {
    const s = store([row(1), manual(8, 1, { source: "imported", rolledBack: true })]);
    const result = await s.run("all");
    expect(result.counts.restored).toBe(0);
    expect(s.all.get(id(8))).toMatchObject({ hidden: true, mergedInto: id(1) });
  });
});
