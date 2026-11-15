import { describe, expect, it } from "vitest";
import {
  BULK_ITEMS_MAX,
  decideTurn,
  distinctIds,
  FOREGROUND_MAX,
  runsInBackground,
  skipExamples,
  summarize,
  undoRemainingMs,
  UNDO_WINDOW_MS,
  type SummaryItem,
} from "./bulk.ts";

const HOUR = 60 * 60 * 1000;
const item = (n: number, outcome: SummaryItem["outcome"], issue: string | null = null): SummaryItem => ({
  recordId: `r${n}`,
  outcome,
  issue,
});

describe("DAT-03@PoC: the rules of a bulk action", () => {
  it("DAT-03@PoC FR 3: the summary counts what changes and what is skipped, by reason", () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => item(i, "pending")),
      item(10, "unchanged"),
      item(11, "unchanged"),
    ];
    expect(summarize(items)).toEqual({
      count: 12,
      changed: 0,
      pending: 10,
      skipped: { unavailable: 0, unchanged: 2, conflict: 0, invalid: 0 },
    });
  });

  it("DAT-03@PoC FR 4: examples of each reason, at most 3, in the selection's order, with the issue of «невалідний»", () => {
    const items = [
      item(1, "unavailable"),
      item(2, "invalid", "label.refused"),
      item(3, "unavailable"),
      item(4, "unavailable"),
      item(5, "unavailable"),
      item(6, "changed"),
    ];
    expect(skipExamples(items)).toEqual([
      { recordId: "r1", reason: "unavailable", issue: null },
      { recordId: "r2", reason: "invalid", issue: "label.refused" },
      { recordId: "r3", reason: "unavailable", issue: null },
      { recordId: "r4", reason: "unavailable", issue: null },
    ]);
  });

  it("DAT-03@PoC FR 6: more than 50 records run in the background", () => {
    expect(FOREGROUND_MAX).toBe(50);
    expect(runsInBackground(50)).toBe(false);
    expect(runsInBackground(51)).toBe(true);
  });

  it("DAT-03@PoC FR 7: at most 500 records; a repeated id is one record", () => {
    expect(BULK_ITEMS_MAX).toBe(500);
    expect(distinctIds(["A", "a", "b"])).toEqual(["a", "b"]);
  });

  it("DAT-03@PoC FR 8: «Відмінити» for 24 hours after the end of a completed or interrupted action", () => {
    const end = Date.parse("2026-10-17T10:00:00Z");
    expect(UNDO_WINDOW_MS).toBe(24 * HOUR);
    expect(undoRemainingMs({ status: "completed", endedAt: end }, end + 3 * HOUR)).toBe(21 * HOUR);
    expect(undoRemainingMs({ status: "interrupted", endedAt: end }, end)).toBe(24 * HOUR);
    expect(undoRemainingMs({ status: "running", endedAt: null }, end)).toBe(0);
    expect(undoRemainingMs({ status: "undone", endedAt: end }, end)).toBe(0);
  });

  it("DAT-03@PoC AC4: 25 hours after the end nothing is left of the window", () => {
    const end = Date.parse("2026-10-17T10:00:00Z");
    expect(undoRemainingMs({ status: "completed", endedAt: end }, end + 25 * HOUR)).toBe(0);
  });

  it("DAT-03@PoC FR 5: a record still at its snapshot's version is written with the single edit's rules", () => {
    expect(
      decideTurn({ versionBefore: 3, after: { label: "a" } }, { version: 3, values: { label: "b" } }),
    ).toEqual({
      kind: "write",
    });
  });

  it("DAT-03@PoC EC1: a record changed by another user since the snapshot is a conflict; a gone one is unavailable", () => {
    expect(
      decideTurn({ versionBefore: 3, after: { label: "a" } }, { version: 4, values: { label: "c" } }),
    ).toEqual({
      kind: "skip",
      reason: "conflict",
    });
    expect(decideTurn({ versionBefore: 3, after: { label: "a" } }, undefined)).toEqual({
      kind: "skip",
      reason: "unavailable",
    });
  });

  it("DAT-03@PoC EC2: a record this action already wrote before a failure is not written again", () => {
    expect(
      decideTurn(
        { versionBefore: 3, after: { label: "a" } },
        { version: 4, values: { label: "a", other: "x" } },
      ),
    ).toEqual({ kind: "already", version: 4 });
  });
});
