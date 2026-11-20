// ===== FILE: apps/api/src/modules/recurring/application/conf653-held-span.test.ts =====
import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { chargesInMonth, trackPayment, type Candidate, type Hold, type TrackInput } from "../domain/index.ts";

/**
 * Confirmation review of #653 (BUD-07@PoC FR 13, BUD-03@PoC FR 5): the held-span exclusion of unpaid charges from the
 * month («Можна витратити») — the survivors of the mutants on `chargesInMonth`. Synthetic amounts, fixed «today».
 */
const eur = (a: string) => Money.of(a, "EUR");
const TODAY = "2026-11-16";

const paidOn = (date: string): Candidate => ({
  id: `t-${date}`,
  date,
  amount: eur("14.00"),
  value: eur("14.00"),
  converted: false,
  approximate: false,
  merchant: true,
  category: false,
});

function track(more: Partial<TrackInput> = {}) {
  const input: TrackInput = {
    frequency: "month",
    anchorDate: "2026-06-05",
    endDate: null,
    createdOn: "2026-07-01",
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

const month = (r: ReturnType<typeof track>, m: string) =>
  chargesInMonth(r.p, r.t, m, TODAY).map((c) => [c.dueOn, c.status]);

describe("BUD-07@PoC FR 13: the held span leaves «Можна витратити», the paid charges stay", () => {
  it("BUD-07@PoC FR 13: «Можливо, скасований» paused to a date — nothing up to the pause's end, the dates after it count (FR 10: the end of the pause restarts the misses)", () => {
    const dated = track({
      candidates: [paidOn("2026-07-05")],
      holds: [{ kind: "pause", from: TODAY, until: "2026-11-30" }],
    });
    expect([dated.t.state, dated.t.hold]).toEqual(["possibly-cancelled", "paused"]);
    expect(month(dated, "2026-11")).toEqual([]);
    expect(month(dated, "2026-12")).toEqual([["2026-12-05", "expected"]]);
    const open = track({
      candidates: [paidOn("2026-07-05")],
      holds: [{ kind: "pause", from: TODAY, until: null }],
    });
    expect(month(open, "2026-12")).toEqual([]);
  });

  it("BUD-07@PoC FR 13: a charge paid within a pause stays in the month; an unpaid one still in its window («Очікується») when the pause began does not", () => {
    const paid = track({
      candidates: [paidOn("2026-11-05")],
      holds: [{ kind: "pause", from: "2026-11-03", until: null }],
    });
    expect(month(paid, "2026-11")).toEqual([["2026-11-05", "paid"]]);
    const inWindow = track({
      anchorDate: "2026-06-15",
      candidates: [paidOn("2026-10-15")],
      holds: [{ kind: "pause", from: TODAY, until: null }],
    });
    expect(inWindow.t.charges.find((c) => c.dueOn === "2026-11-15")?.status).toBe("expected");
    expect(month(inWindow, "2026-11")).toEqual([]);
  });

  it("BUD-07@PoC FR 13: a pause whose last day is today still holds — the charge overdue before it is out of the month", () => {
    const pause: Hold = { kind: "pause", from: "2026-11-10", until: TODAY };
    const r = track({
      createdOn: "2026-09-01",
      candidates: [paidOn("2026-09-05"), paidOn("2026-10-05")],
      holds: [pause],
    });
    expect(r.t.hold).toBe("paused");
    expect(r.t.charges.find((c) => c.dueOn === "2026-11-05")?.status).toBe("overdue");
    expect(month(r, "2026-11")).toEqual([]);
  });
});
