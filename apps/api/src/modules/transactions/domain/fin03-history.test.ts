import { describe, expect, it } from "vitest";
import { HISTORY_MASK, newestHistory, transactionHistory, type LoggedEntry } from "./history.ts";

const READER = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";

const entry = (over: Partial<LoggedEntry> & Pick<LoggedEntry, "id" | "occurredAt">): LoggedEntry => ({
  actorKind: "user",
  actorId: READER,
  channel: "web",
  action: "update",
  changes: [],
  ...over,
});

describe("FIN-03@PoC FR 27: «Історія змін» from the audit log", () => {
  it("FIN-03@PoC FR 27: entries of the transaction and of its category, oldest first; entries of one millisecond keep the log's order", () => {
    const history = transactionHistory(
      [
        entry({
          id: "00000000-0000-4000-8000-000000000003",
          occurredAt: "2026-11-16T10:00:02.000Z",
          changes: [{ field: "categoryId", before: null, after: "c1", masked: false }],
        }),
        // One millisecond: the log's order (create, then the edit), whatever the ids.
        entry({
          id: "00000000-0000-4000-8000-000000000009",
          occurredAt: "2026-11-16T10:00:01.000Z",
          action: "create",
          changes: [{ field: "amount", before: null, after: "-30.00", masked: false }],
        }),
        entry({
          id: "00000000-0000-4000-8000-000000000002",
          occurredAt: "2026-11-16T10:00:01.000Z",
          changes: [{ field: "amount", before: "-30.00", after: "-25.00", masked: false }],
        }),
      ],
      READER,
    );
    expect(history.map((e) => e.id.slice(-1))).toEqual(["9", "2", "3"]);
    expect(history[0]).toEqual({
      id: "00000000-0000-4000-8000-000000000009",
      occurredAt: "2026-11-16T10:00:01.000Z",
      actor: "you",
      channel: "web",
      action: "create",
      changes: [{ field: "amount", before: null, after: "-30.00", masked: false }],
    });
  });

  it("FIN-03@PoC FR 20: who is told relative to the reader — never an account id", () => {
    const history = transactionHistory(
      [
        entry({ id: "1", occurredAt: "a", action: "create", actorId: READER }),
        entry({ id: "2", occurredAt: "b", action: "create", actorId: OTHER }),
        entry({ id: "3", occurredAt: "c", action: "create", actorKind: "staff", actorId: OTHER }),
        entry({ id: "4", occurredAt: "d", action: "create", actorKind: "system", actorId: null }),
      ],
      READER,
    );
    expect(history.map((e) => e.actor)).toEqual(["you", "member", "staff", "system"]);
    expect(JSON.stringify(history)).not.toContain(READER);
    expect(JSON.stringify(history)).not.toContain(OTHER);
  });

  it("FIN-03@PoC FR 20: a masked field never carries its text, even if the stored value is not the mask", () => {
    const [e] = transactionHistory(
      [
        entry({
          id: "1",
          occurredAt: "a",
          changes: [
            { field: "counterparty", before: "Синтетичний Сільпо", after: null, masked: true },
            { field: "note", before: null, after: HISTORY_MASK, masked: true },
          ],
        }),
      ],
      READER,
    );
    expect(e!.changes).toEqual([
      { field: "counterparty", before: HISTORY_MASK, after: null, masked: true },
      { field: "note", before: null, after: HISTORY_MASK, masked: true },
    ]);
  });

  it("FIN-03@PoC FR 20: a group entry's changes of other records are not this transaction's; an update left empty is dropped", () => {
    const history = transactionHistory(
      [
        entry({
          id: "1",
          occurredAt: "a",
          changes: [{ record: OTHER, field: "tags", before: null, after: "t1", masked: false }],
        }),
        entry({ id: "2", occurredAt: "b", action: "delete" }),
        entry({ id: "3", occurredAt: "c", action: "purge" }),
      ],
      READER,
    );
    expect(history.map((e) => e.id)).toEqual(["2"]);
  });

  it("FIN-03@PoC FR 20: free text is masked by its field name too, whatever the log marked or stored", () => {
    const [e] = transactionHistory(
      [
        entry({
          id: "1",
          occurredAt: "a",
          changes: [
            // Marked not masked, with the text itself: a log written before the mark, or with a wrong one.
            {
              field: "counterparty",
              before: "Синтетичний Сільпо",
              after: "Синтетична Аптека",
              masked: false,
            },
            { field: "description", before: null, after: "Синтетичний опис", masked: false },
            { field: "note", before: "Синтетична нотатка", after: null, masked: false },
            { field: "amount", before: "-30", after: "-25", masked: false },
          ],
        }),
      ],
      READER,
    );
    expect(e!.changes).toEqual([
      { field: "counterparty", before: HISTORY_MASK, after: HISTORY_MASK, masked: true },
      { field: "description", before: null, after: HISTORY_MASK, masked: true },
      { field: "note", before: HISTORY_MASK, after: null, masked: true },
      { field: "amount", before: "-30", after: "-25", masked: false },
    ]);
    expect(JSON.stringify(e)).not.toContain("Синтетич");
  });

  it("FIN-03@PoC FR 27: one answer keeps the newest entries, oldest first, and says that older ones were left out", () => {
    const history = transactionHistory(
      Array.from({ length: 7 }, (_, i) =>
        entry({
          id: String(i),
          occurredAt: `2026-11-16T10:00:0${i}.000Z`,
          changes: [{ field: "amount", before: String(i), after: String(i + 1), masked: false }],
        }),
      ),
      READER,
    );
    const capped = newestHistory(history, 5);
    expect(capped.truncated).toBe(true);
    expect(capped.items.map((e) => e.id)).toEqual(["2", "3", "4", "5", "6"]);
    expect(newestHistory(history, 7)).toEqual({ items: history, truncated: false });
  });
});
