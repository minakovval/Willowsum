import { describe, expect, it } from "vitest";
import { BATCH_STATES, BatchStateError, canMove, move, takesFiles, type BatchState } from "./index.ts";

/** IMP-01@PoC FR 10 and IMP-19@PoC FR 5: every step between two states, allowed or refused. */
const ALLOWED: readonly (readonly [BatchState, BatchState])[] = [
  ["uploaded", "processing"],
  ["processing", "parsed"],
  ["processing", "needs-review"],
  ["processing", "failed"],
  ["parsed", "applied"],
  ["needs-review", "applied"],
  ["applied", "rolled-back"],
  // Re-parsing (FR 21).
  ["parsed", "processing"],
  ["needs-review", "processing"],
  ["failed", "processing"],
  // «Скасовано» from any state before «застосовано».
  ["uploaded", "cancelled"],
  ["processing", "cancelled"],
  ["parsed", "cancelled"],
  ["needs-review", "cancelled"],
  ["failed", "cancelled"],
];

describe("IMP-01@PoC FR 10: the states of a batch", () => {
  const allowed = new Set(ALLOWED.map(([a, b]) => `${a}→${b}`));
  const pairs = BATCH_STATES.flatMap((from) => BATCH_STATES.map((to) => [from, to] as const));

  it.each(ALLOWED)("IMP-19@PoC FR 5: %s → %s is allowed", (from, to) => {
    expect(canMove(from, to)).toBe(true);
    expect(move(from, to)).toBe(to);
  });

  it.each(pairs.filter(([a, b]) => !allowed.has(`${a}→${b}`)))(
    "IMP-01@PoC FR 10: %s → %s is refused",
    (from, to) => {
      expect(canMove(from, to)).toBe(false);
      expect(() => move(from, to)).toThrow(BatchStateError);
    },
  );

  it("IMP-01@PoC FR 10: an applied batch is never cancelled; a rolled-back or cancelled one takes no step", () => {
    expect(canMove("applied", "cancelled")).toBe(false);
    expect(canMove("failed", "applied")).toBe(false);
    for (const to of BATCH_STATES) {
      expect(canMove("rolled-back", to)).toBe(false);
      expect(canMove("cancelled", to)).toBe(false);
    }
  });

  it("IMP-01@PoC FR 10: files are added only while the batch is «завантажено»", () => {
    expect(BATCH_STATES.filter(takesFiles)).toEqual(["uploaded"]);
  });
});
