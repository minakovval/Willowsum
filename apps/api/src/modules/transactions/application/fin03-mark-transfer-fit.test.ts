import { exchangeRate, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import type { StoredTransaction } from "./stored.ts";
import type { Caller, TransactionsTx } from "./transactions.ts";
import { markTransfer, type InTransactions, type TransferDeps } from "./transfers.ts";

// Follow-up #466 of #464 (issue #461): the journal-fit check of markTransfer reads the rows as they are under the
// lock, not as the first read saw them, and refuses before any write. Synthetic ids, amounts and rate; no I/O.
const DATE = "2026-10-14";
const OUT = "00000000-0000-4000-8000-0000000000a1";
const IN = "00000000-0000-4000-8000-0000000000a2";
const caller = { householdId: "00000000-0000-4000-8000-0000000000b1", accountId: "u1" } as unknown as Caller;

function row(id: string, accountId: string, amount: Money): StoredTransaction {
  return {
    id,
    accountId,
    subaccountId: `${accountId}-s`,
    amount,
    date: DATE,
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
    createdAt: "2026-10-14T10:00:00Z",
  };
}

/** `seen`: the rows of the first read; `locked`: the rows under the lock. Every write is recorded. */
function harness(seen: Record<string, StoredTransaction>, locked: Record<string, StoredTransaction>) {
  const writes: string[] = [];
  const calls: string[] = [];
  const tx = {
    find: async (_h: string, id: string) => seen[id] ?? null,
    lock: async (_h: string, id: string) => (calls.push(`lock:${id}`), locked[id] ?? null),
    // Row 198: the accounts' money lock before their state is read.
    lockAccounts: async () => undefined,
    insertTransfer: async () => void writes.push("insertTransfer"),
    update: async (_h: string, t: StoredTransaction) => (writes.push(`update:${t.id}`), t),
    enqueueHandOff: async () => void writes.push("enqueueHandOff"),
  } as unknown as TransactionsTx;
  const inTransactions: InTransactions = (work) => work(tx);
  let n = 0;
  const deps = {
    newId: () => `00000000-0000-4000-8000-00000000000${++n}`,
    rates: async () => [exchangeRate({ base: "EUR", quote: "UAH", rate: "43.5", date: DATE, source: "NBU" })],
    accounts: {
      postingAccount: async () => (calls.push("postingAccount"), { status: "closed" as const }),
    },
  } as unknown as TransferDeps;
  return { deps, inTransactions, writes, calls };
}

describe("FIN-03@PoC FR 27: markTransfer's journal-fit check", () => {
  const out = row(OUT, "acc-uah", Money.of("-1.00", "UAH"));
  const small = row(IN, "acc-eur", Money.of("1.00", "EUR"));
  const over = row(IN, "acc-eur", Money.of("2298850574712643678.17", "EUR"));
  const fits = row(IN, "acc-eur", Money.of("2298850574712643678.16", "EUR"));

  it("FIN-03@PoC FR 27: a credit that grew beyond the journal between the first read and the lock is refused; nothing is written", async () => {
    const h = harness({ [OUT]: out, [IN]: small }, { [OUT]: out, [IN]: over });
    expect(await markTransfer(h.deps, h.inTransactions, caller, OUT, IN)).toEqual({
      kind: "invalid",
      issues: [{ field: "counterpartId", issue: "invalid" }],
    });
    expect(h.writes).toEqual([]);
    // Both rows were locked before the check; the field issue comes before the account's state.
    expect(h.calls).toEqual([`lock:${OUT}`, `lock:${IN}`]);
  });

  it("FIN-03@PoC FR 27: a credit that shrank to fit by the time of the lock is not refused by the first read's amount", async () => {
    const h = harness({ [OUT]: out, [IN]: over }, { [OUT]: out, [IN]: fits });
    // The harness's accounts are closed, so a pair that passes the fit check stops there, still with nothing written.
    expect(await markTransfer(h.deps, h.inTransactions, caller, OUT, IN)).toEqual({ kind: "closed" });
    expect(h.writes).toEqual([]);
  });
});
