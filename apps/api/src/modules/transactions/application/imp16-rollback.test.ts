import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { changedAfterApply, type RollbackCategory } from "./rollback.ts";
import type { StoredTransaction } from "./stored.ts";

/** IMP-16@PoC FR 4 (wave 2 row 44): which transactions of a batch the person changed after the apply. Synthetic data. */
const row = (over: Partial<StoredTransaction> = {}): StoredTransaction => ({
  id: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-0000000000a1",
  subaccountId: "00000000-0000-4000-8000-0000000000b1",
  amount: Money.of("-30.00", "EUR"),
  date: "2026-04-13",
  counterparty: null,
  description: "SHOP 1",
  status: "posted",
  source: "imported",
  hidden: false,
  split: null,
  transfer: null,
  mergedInto: null,
  note: null,
  tagIds: [],
  oneOff: false,
  review: "queued",
  version: 1,
  createdAt: "2026-11-20T10:00:00.000Z",
  ...over,
});
const manual = row({ id: "00000000-0000-4000-8000-000000000002", source: "manual", note: "Обід з колегами" });
const categories = (entries: [string, RollbackCategory][]) => new Map(entries);

describe("IMP-16@PoC FR 4: a change of the person's after the apply", () => {
  it("IMP-16@PoC FR 4: untouched — not changed; a note, a split or a category «вручну» — changed", () => {
    expect(changedAfterApply(row(), null, categories([]))).toBe(false);
    expect(changedAfterApply(row({ note: "Подарунок" }), null, categories([]))).toBe(true);
    expect(
      changedAfterApply(
        row({ split: { mode: "categories", needsReview: false, parts: [] } }),
        null,
        categories([]),
      ),
    ).toBe(true);
    expect(
      changedAfterApply(row(), null, categories([[row().id, { categoryId: "c", source: "manual" }]])),
    ).toBe(true);
    // A category of a rule or the bank is no change of the person's.
    expect(
      changedAfterApply(row(), null, categories([[row().id, { categoryId: "c", source: "rule" }]])),
    ).toBe(false);
  });

  it("IMP-16@PoC FR 4: the note and the category a manual transaction merged on apply brought are no change; another one is", () => {
    const carried = categories([
      [row().id, { categoryId: "cafe", source: "manual" }],
      [manual.id, { categoryId: "cafe", source: "manual" }],
    ]);
    expect(changedAfterApply(row({ note: "Обід з колегами" }), manual, carried)).toBe(false);
    expect(changedAfterApply(row({ note: "Інша" }), manual, carried)).toBe(true);
    const recategorized = categories([
      [row().id, { categoryId: "gifts", source: "manual" }],
      [manual.id, { categoryId: "cafe", source: "manual" }],
    ]);
    expect(changedAfterApply(row({ note: "Обід з колегами" }), manual, recategorized)).toBe(true);
  });
});
