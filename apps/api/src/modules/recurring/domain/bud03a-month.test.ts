import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { chargesInMonth, scheduleBetween, trackPayment, type Candidate, type TrackInput } from "./index.ts";

/**
 * BUD-03@PoC a) (wave 2 row 34; #567): the charges of a payment in one month, as the budget reads them — the tracked ones
 * with their status, the later ones of the month «Очікується». Pure rules with a fixed «today» (16 November 2026).
 */
const eur = (a: string) => Money.of(a, "EUR");
const TODAY = "2026-11-16";

const paidOn = (date: string, amount: string): Candidate => ({
  id: `t-${date}`,
  date,
  amount: eur(amount),
  value: eur(amount),
  converted: false,
  approximate: false,
  merchant: true,
  category: false,
});

const payment = (more: Partial<TrackInput> = {}) => {
  const input: TrackInput = {
    frequency: "week",
    anchorDate: "2026-10-05",
    endDate: null,
    createdOn: "2026-10-01",
    keptOn: null,
    type: "expense",
    base: eur("10"),
    variable: false,
    marks: new Map(),
    candidates: [],
    from: "2025-09-13",
    today: TODAY,
    ...more,
  };
  return {
    p: { id: "p1", categoryId: "c1", ...input },
    t: trackPayment(input),
  };
};

describe("BUD-03@PoC FR 5: the month's charges of a regular payment", () => {
  it("BUD-03@PoC FR 5: a weekly payment — the paid charge, the overdue one, today's and the later dates of the month «Очікується»", () => {
    const { p, t } = payment({ candidates: [paidOn("2026-11-02", "10")] });
    const month = chargesInMonth(p, t, "2026-11", TODAY);
    expect(month.map((c) => [c.dueOn, c.status, c.expected.toDecimalString()])).toEqual([
      ["2026-11-02", "paid", "10"],
      ["2026-11-09", "overdue", "10"],
      ["2026-11-16", "expected", "10"],
      ["2026-11-23", "expected", "10"],
      ["2026-11-30", "expected", "10"],
    ]);
    expect(month[1]!.overdueDays).toBe(7);
    expect(month.every((c) => c.categoryId === "c1" && c.paymentId === "p1" && c.type === "expense")).toBe(
      true,
    );
  });

  it("BUD-03@PoC FR 5: a future month — every date of the schedule at the expected amount now", () => {
    const { p, t } = payment({ frequency: "month", anchorDate: "2026-01-31" });
    expect(chargesInMonth(p, t, "2027-02", TODAY).map((c) => [c.dueOn, c.status])).toEqual([
      ["2027-02-28", "expected"],
    ]);
  });

  it("BUD-03@PoC FR 5: a payment «Можливо, скасований» has no charges; none after the end date", () => {
    const cancelled = payment({ frequency: "month", anchorDate: "2026-08-05", createdOn: "2026-08-01" });
    expect(cancelled.t.state).toBe("possibly-cancelled");
    expect(chargesInMonth(cancelled.p, cancelled.t, "2026-11", TODAY)).toEqual([]);
    const ended = payment({ endDate: "2026-11-20", candidates: [paidOn("2026-11-09", "10")] });
    expect(chargesInMonth(ended.p, ended.t, "2026-11", TODAY).map((c) => c.dueOn)).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
    ]);
    const gone = payment({ endDate: "2026-10-31", candidates: [paidOn("2026-10-26", "10")] });
    expect(gone.t.state).toBe("active");
    expect(chargesInMonth(gone.p, gone.t, "2026-11", TODAY)).toEqual([]);
  });

  it("BUD-03@PoC FR 5: «Позначити пропущеним» — the charge is «Пропущено», no more unpaid", () => {
    const { p, t } = payment({
      candidates: [paidOn("2026-11-02", "10")],
      marks: new Map([["2026-11-09", { kind: "skipped", markedOn: TODAY }]]),
    });
    expect(chargesInMonth(p, t, "2026-11", TODAY)[1]).toMatchObject({
      dueOn: "2026-11-09",
      status: "skipped",
    });
  });

  it("BUD-03@PoC FR 5: a payment added after this month's date has no charge of that date — nothing unpaid for a day before it was added", () => {
    const { p, t } = payment({ frequency: "month", anchorDate: "2026-11-10", createdOn: "2026-11-12" });
    expect(chargesInMonth(p, t, "2026-11", TODAY)).toEqual([]);
  });

  it("BUD-03@PoC FR 5 boundary: the schedule's dates between two days, both included, before the anchor too", () => {
    expect(scheduleBetween("2026-11-16", "two-weeks", "2026-11-01", "2026-11-30")).toEqual([
      "2026-11-02",
      "2026-11-16",
      "2026-11-30",
    ]);
    expect(scheduleBetween("2026-01-31", "quarter", "2026-11-01", "2026-11-30")).toEqual([]);
    expect(scheduleBetween("2020-03-15", "year", "2026-03-01", "2026-03-31")).toEqual(["2026-03-15"]);
  });
});
