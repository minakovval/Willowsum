import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { applyHandOff, type HandOffDeps, type TransactionRows } from "./hand-off.ts";
import type { StoredTransaction } from "./stored.ts";

/**
 * ARC-04@PoC FR 2 (#257 item 2): a row left over from the old order — version 1, its only journal entry reversed — is
 * never reported as posted: the key `transactions.create:<id>` returns the reversed entry and posts nothing, so the
 * hand-off fails (the job is retried and the dead ones are requeued daily) instead of leaving the balance without it.
 */
const row: StoredTransaction = {
  id: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-0000000000a1",
  subaccountId: "00000000-0000-4000-8000-0000000000b1",
  amount: Money.of("-10.00", "EUR"),
  date: "2026-10-10",
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
  review: null,
  version: 1,
  createdAt: "2026-10-10T10:00:00Z",
};

function deps(live: readonly { id: string }[], posted: { id: string }) {
  const audit: unknown[] = [];
  const handOffDeps = {
    accounts: {
      postingAccount: async () => ({
        accountId: row.accountId,
        status: "active" as const,
        subaccounts: [{ subaccountId: row.subaccountId, currency: "EUR", ledgerAccountId: "ledger-1" }],
      }),
    },
    ledger: {
      liveEntries: async () => live,
      post: async () => posted,
      correct: async () => {
        throw new Error("not expected");
      },
      reverse: async () => {
        throw new Error("not expected");
      },
    },
    audit: { changed: async (...args: unknown[]) => void audit.push(args) },
  } as unknown as HandOffDeps;
  const rows: TransactionRows = { whileLocked: async (_h, _t, work) => work(row, async () => null) };
  return { handOffDeps, rows, audit };
}

const handOff = {
  transactionId: row.id,
  actorAccountId: "00000000-0000-4000-8000-0000000000c1",
  action: "update" as const,
  version: 1,
  audit: [],
};

describe("ARC-04@PoC FR 2: a hand-off never reports a reversed first entry as posted", () => {
  it("ARC-04@PoC FR 2: the key returns a reversed entry that is not in effect — the hand-off throws and writes no audit entry", async () => {
    const { handOffDeps, rows, audit } = deps([], { id: "reversed-entry" });
    await expect(applyHandOff(handOffDeps, rows, "household", handOff)).rejects.toThrow(/reversed/);
    expect(audit).toEqual([]);
  });

  it("ARC-04@PoC FR 2: the entry made is in effect — the hand-off completes and writes the audit entry", async () => {
    const entry = { id: "live-entry" };
    let calls = 0;
    const { handOffDeps, rows, audit } = deps([], entry);
    // First read: no entry in effect (so it posts); second read, after posting: the entry is there.
    (handOffDeps.ledger as { liveEntries: unknown }).liveEntries = async () => (calls++ === 0 ? [] : [entry]);
    await applyHandOff(handOffDeps, rows, "household", handOff);
    expect(audit).toHaveLength(1);
  });
});
