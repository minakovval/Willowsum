import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { nextPaymentDate } from "./index.ts";
import {
  chargesInMonth,
  holdAction,
  trackPayment,
  type Candidate,
  type Hold,
  type TrackInput,
} from "../domain/index.ts";

/**
 * BUD-07@PoC b2) (wave 2 row 26): «Призупинити», «Позначити скасованим» and «Відновити» (FR 13) — the held charges leave
 * the schedule, the misses and the month's charges («Можна витратити»), the paid ones stay. Pure rules with a fixed
 * «today» (16 November 2026); every amount is synthetic.
 */
const eur = (a: string) => Money.of(a, "EUR");
const TODAY = "2026-11-16";

const paidOn = (date: string, amount = "14.00"): Candidate => ({
  id: `t-${date}`,
  date,
  amount: eur(amount),
  value: eur(amount),
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

const statuses = (t: ReturnType<typeof trackPayment>) => t.charges.map((c) => [c.dueOn, c.status]);

describe("BUD-07@PoC FR 13: a pause to a date or until «Відновити»", () => {
  it("BUD-07@PoC FR 13: paused until a date — its charges and its share of «Можна витратити» are gone; the paid history stays", () => {
    const pause: Hold = { kind: "pause", from: "2026-11-01", until: "2026-12-10" };
    const { p, t } = track({
      createdOn: "2026-09-01",
      candidates: [paidOn("2026-09-05"), paidOn("2026-10-05")],
      holds: [pause],
    });
    expect(t.state).toBe("paused");
    expect(statuses(t)).toEqual([
      ["2026-09-05", "paid"],
      ["2026-10-05", "paid"],
    ]);
    expect(t.missesInRow).toBe(0);
    expect(chargesInMonth(p, t, "2026-11", TODAY)).toEqual([]);
    expect(chargesInMonth(p, t, "2026-12", TODAY)).toEqual([]);
    // After the pause the schedule is back: the January charge is expected.
    expect(chargesInMonth(p, t, "2027-01", TODAY).map((c) => [c.dueOn, c.status])).toEqual([
      ["2027-01-05", "expected"],
    ]);
    expect(nextPaymentDate(p, TODAY, [pause])).toBe("2027-01-05");
  });

  it("BUD-07@PoC FR 13: paused until «Відновити» — no next date; a paid charge within the pause still shows paid", () => {
    const pause: Hold = { kind: "pause", from: "2026-11-03", until: null };
    const { p, t } = track({ candidates: [paidOn("2026-11-05")], holds: [pause] });
    expect(t.state).toBe("paused");
    expect(t.charges.find((c) => c.dueOn === "2026-11-05")?.status).toBe("paid");
    expect(nextPaymentDate(p, TODAY, [pause])).toBeNull();
    expect(chargesInMonth(p, t, "2026-12", TODAY)).toEqual([]);
  });

  it("BUD-07@PoC FR 13: «Відновити» restarts the misses — two misses before the pause no longer make it «Можливо, скасований»", () => {
    // August and September missed: «Можливо, скасований» before the pause.
    const before = track({ candidates: [paidOn("2026-07-05")], today: "2026-10-01" });
    expect(before.t.state).toBe("possibly-cancelled");
    const held = holdAction([], before.t.state, { kind: "pause", until: null }, "2026-10-01")!;
    const resumed = holdAction(held, "paused", { kind: "resume" }, TODAY)!;
    expect(resumed).toEqual([{ kind: "pause", from: "2026-10-01", until: "2026-11-15" }]);
    const { p, t } = track({ candidates: [paidOn("2026-07-05")], holds: resumed });
    expect(t.state).toBe("active");
    expect(t.missesInRow).toBe(0);
    // The October and November charges were paused: not shown; the old misses stay in the history.
    expect(statuses(t)).toEqual([
      ["2026-07-05", "paid"],
      ["2026-08-05", "overdue"],
      ["2026-09-05", "overdue"],
      ["2026-12-05", "expected"],
    ]);
    expect(chargesInMonth(p, t, "2026-11", TODAY)).toEqual([]);
    expect(chargesInMonth(p, t, "2026-12", TODAY).map((c) => c.dueOn)).toEqual(["2026-12-05"]);
  });

  it("BUD-07@PoC FR 13: a dated pause that has ended counts the misses from its next day on", () => {
    const { t } = track({
      candidates: [paidOn("2026-07-05")],
      holds: [{ kind: "pause", from: "2026-08-01", until: "2026-10-31" }],
    });
    // Only November is a miss: the paused months are none, so it is not «Можливо, скасований».
    expect(t.state).toBe("active");
    expect(t.missesInRow).toBe(1);
    expect(statuses(t)).toEqual([
      ["2026-07-05", "paid"],
      ["2026-11-05", "overdue"],
      ["2026-12-05", "expected"],
    ]);
  });

  it("BUD-07@PoC FR 13: a pause is refused while paused or marked cancelled; «Відновити» only for a paused or cancelled payment", () => {
    expect(holdAction([], "paused", { kind: "pause", until: null }, TODAY)).toBeNull();
    expect(holdAction([], "cancelled", { kind: "pause", until: null }, TODAY)).toBeNull();
    expect(holdAction([], "active", { kind: "resume" }, TODAY)).toBeNull();
    expect(holdAction([], "possibly-cancelled", { kind: "resume" }, TODAY)).toBeNull();
    expect(holdAction([], "possibly-cancelled", { kind: "pause", until: "2026-12-01" }, TODAY)).toEqual([
      { kind: "pause", from: TODAY, until: "2026-12-01" },
    ]);
    // Paused and resumed the same day: nothing was held.
    const same = holdAction([], "active", { kind: "pause", until: null }, TODAY)!;
    expect(holdAction(same, "paused", { kind: "resume" }, TODAY)).toEqual([]);
  });
});

describe("BUD-07@PoC FR 13: «Позначити скасованим» — a mark in the app only", () => {
  it("BUD-07@PoC FR 13: marked cancelled — gone from the plan from this month on, the history of its charges stays", () => {
    const holds = holdAction([], "active", { kind: "cancel" }, TODAY)!;
    expect(holds).toEqual([{ kind: "cancel", from: "2026-11-01", until: null }]);
    const { p, t } = track({
      createdOn: "2026-09-01",
      candidates: [paidOn("2026-09-05"), paidOn("2026-10-05")],
      holds,
    });
    expect(t.state).toBe("cancelled");
    // The November charge (overdue by now) is gone; September and October stay paid.
    expect(statuses(t)).toEqual([
      ["2026-09-05", "paid"],
      ["2026-10-05", "paid"],
    ]);
    expect(chargesInMonth(p, t, "2026-11", TODAY)).toEqual([]);
    expect(chargesInMonth(p, t, "2026-10", TODAY).map((c) => [c.dueOn, c.status])).toEqual([
      ["2026-10-05", "paid"],
    ]);
    expect(nextPaymentDate(p, TODAY, holds)).toBeNull();
  });

  it("BUD-07@PoC FR 13: a cancelled payment can be restored; a pause ends with the mark, and the mark cannot be set twice", () => {
    const paused = holdAction([], "active", { kind: "pause", until: "2027-02-01" }, "2026-11-10")!;
    const cancelled = holdAction(paused, "paused", { kind: "cancel" }, TODAY)!;
    expect(cancelled).toEqual([
      { kind: "pause", from: "2026-11-10", until: "2026-11-15" },
      { kind: "cancel", from: "2026-11-01", until: null },
    ]);
    expect(holdAction(cancelled, "cancelled", { kind: "cancel" }, TODAY)).toBeNull();
    const restored = holdAction(cancelled, "cancelled", { kind: "resume" }, "2026-11-20")!;
    expect(restored).toEqual([
      { kind: "pause", from: "2026-11-10", until: "2026-11-15" },
      { kind: "cancel", from: "2026-11-01", until: "2026-11-19" },
    ]);
    const { p, t } = track({ holds: restored, today: "2026-11-20", candidates: [paidOn("2026-10-05")] });
    expect(t.state).toBe("active");
    expect(nextPaymentDate(p, "2026-11-20", restored)).toBe("2026-12-05");
  });

  it("BUD-07@PoC FR 13: a hold keeps the fields it was stored with (its id) when it ends", () => {
    const stored = [{ id: "h1", kind: "pause" as const, from: "2026-11-01", until: null }];
    expect(holdAction(stored, "paused", { kind: "resume" }, TODAY)).toEqual([
      { id: "h1", kind: "pause", from: "2026-11-01", until: "2026-11-15" },
    ]);
  });
});
