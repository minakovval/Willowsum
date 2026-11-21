import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { nextPaymentDate } from "./index.ts";
import { chargesInMonth, trackPayment, type Hold, type TrackInput } from "../domain/index.ts";

/**
 * Security review of #653 (BUD-07@PoC FR 13): the last day of a hold is held too — the survivor of the mutant
 * `date < h.until` in `heldOn` (a charge due on the pause's last day came back into «Можна витратити»).
 */
const eur = (a: string) => Money.of(a, "EUR");
const TODAY = "2026-11-16";

function track(more: Partial<TrackInput> = {}) {
  const input: TrackInput = {
    frequency: "month",
    anchorDate: "2026-06-05",
    endDate: null,
    createdOn: "2026-09-01",
    keptOn: null,
    type: "expense",
    base: eur("14.00"),
    variable: false,
    marks: new Map(),
    candidates: [],
    from: "2025-09-13",
    today: TODAY,
    ...more,
  };
  return { p: { id: "p1", categoryId: "c1", ...input }, t: trackPayment(input) };
}

describe("BUD-07@PoC FR 13: the first and the last day of a hold are held", () => {
  it("BUD-07@PoC FR 13: a charge due on the pause's last day is not in the month's charges; one due the next day is", () => {
    const last: Hold = { kind: "pause", from: TODAY, until: "2026-12-05" };
    const held = track({ holds: [last] });
    expect(chargesInMonth(held.p, held.t, "2026-12", TODAY)).toEqual([]);
    expect(nextPaymentDate(held.p, TODAY, [last])).toBe("2027-01-05");
    const before: Hold = { kind: "pause", from: TODAY, until: "2026-12-04" };
    const free = track({ holds: [before] });
    expect(chargesInMonth(free.p, free.t, "2026-12", TODAY).map((c) => [c.dueOn, c.status])).toEqual([
      ["2026-12-05", "expected"],
    ]);
    expect(nextPaymentDate(free.p, TODAY, [before])).toBe("2026-12-05");
  });

  it("BUD-07@PoC FR 13: an unpaid charge due on the last day of a pause that ended is not shown and is no miss; one due on its first day neither", () => {
    const ended = track({ holds: [{ kind: "pause", from: "2026-10-05", until: "2026-11-05" }] });
    expect(ended.t.charges.map((c) => [c.dueOn, c.status])).toEqual([
      ["2026-09-05", "overdue"],
      ["2026-12-05", "expected"],
    ]);
    expect(chargesInMonth(ended.p, ended.t, "2026-11", TODAY)).toEqual([]);
    expect(chargesInMonth(ended.p, ended.t, "2026-10", TODAY)).toEqual([]);
    expect(ended.t.missesInRow).toBe(0);
  });
});
