import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { post, type Entry, type LedgerStore } from "./index.ts";

/** Security review of PR #122: kills the survivor «a lost idempotency race still writes postings». */

const H1 = "11111111-1111-4111-8111-111111111111";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const SOURCE = { module: "transactions", id: "00000000-0000-4000-8000-0000000000f1" };

describe("sec122 ARC-11: a lost race on the idempotency key returns the winner's entry and writes no postings", () => {
  it("insertEntry → false: no insertPostings, the stored entry is returned", async () => {
    const winner: Entry = {
      id: "00000000-0000-4000-8000-0000000000e0",
      source: SOURCE,
      eventType: "transfer",
      operationDate: "2026-06-30",
      recordedAt: "2026-06-30T10:00:00.000000Z",
      rulesVersion: 1,
      reversesEntryId: null,
      postings: [],
    };
    let byKey = 0;
    let postingsWritten = 0;
    const store: LedgerStore = {
      inHousehold: (_h, work) =>
        work({
          entryByKey: async () => (byKey++ === 0 ? null : winner),
          accounts: async (ids: readonly string[]) =>
            ids.map((id) => ({ id, type: "asset", currency: "EUR" })),
          insertEntry: async () => false,
          insertPostings: async () => {
            postingsWritten++;
          },
          entry: async () => null,
        } as never),
    };
    const entry = await post({ store, newId: () => "00000000-0000-4000-8000-0000000000e1" }, H1, {
      source: SOURCE,
      idempotencyKey: "k",
      operationDate: "2026-06-30",
      event: { type: "transfer", from: A, to: B, amount: Money.of("5", "EUR") },
    });
    expect(entry).toBe(winner);
    expect(postingsWritten).toBe(0);
  });
});
