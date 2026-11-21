import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  chargesInMonth,
  chargesOfFinishedMonth,
  trackPayment,
  type Candidate,
  type TrackInput,
} from "./index.ts";

/**
 * FLW-38@PoC FR 1 (S-135 «Підсумок періоду», card «Регулярні платежі»): the charges of a finished month of one payment
 * — the tracked ones with their status and the day paid, whatever the payment's state now. Pure rules with a fixed
 * «today» (18 November 2026); every amount is synthetic.
 */
const eur = (a: string) => Money.of(a, "EUR");
const TODAY = "2026-11-18";

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
    frequency: "month",
    anchorDate: "2026-08-10",
    endDate: null,
    createdOn: "2026-08-01",
    keptOn: null,
    type: "expense",
    base: eur("150"),
    variable: false,
    marks: new Map(),
    candidates: [],
    from: "2025-09-15",
    today: TODAY,
    ...more,
  };
  return { p: { id: "p1", categoryId: "c1", ...input }, t: trackPayment(input) };
};

describe("FLW-38@PoC FR 1: a finished month's charges of a regular payment", () => {
  it("FLW-38@PoC FR 1: the October charge paid on time — «Сплачено» with its date", () => {
    const { p, t } = payment({ candidates: [paidOn("2026-10-11", "150")] });
    expect(chargesOfFinishedMonth(p, t, "2026-10")).toEqual([
      {
        paymentId: "p1",
        type: "expense",
        categoryId: "c1",
        dueOn: "2026-10-10",
        expected: eur("150"),
        status: "paid",
        overdueDays: null,
        paidOn: "2026-10-11",
      },
    ]);
  });

  it("FLW-38@PoC FR 1: a charge not paid in its month stays «Прострочено» in that month's summary", () => {
    const { p, t } = payment({ candidates: [paidOn("2026-08-10", "150"), paidOn("2026-09-10", "150")] });
    const [october] = chargesOfFinishedMonth(p, t, "2026-10");
    expect(october).toMatchObject({ dueOn: "2026-10-10", status: "overdue", paidOn: null });
    expect(october!.overdueDays).toBeGreaterThan(0);
  });

  it("FLW-38@PoC FR 1: a payment «Можливо, скасований» now keeps its paid charge of the finished month (unlike the budget's month)", () => {
    // Paid in August, then two misses in a row (September, October) — «Можливо, скасований» (BUD-07 FR 10).
    const { p, t } = payment({
      anchorDate: "2026-07-10",
      createdOn: "2026-07-01",
      candidates: [paidOn("2026-07-10", "150"), paidOn("2026-08-10", "150")],
    });
    expect(t.state).toBe("possibly-cancelled");
    expect(chargesInMonth(p, t, "2026-08", TODAY)).toEqual([]);
    expect(chargesOfFinishedMonth(p, t, "2026-08").map((c) => [c.dueOn, c.status, c.paidOn])).toEqual([
      ["2026-08-10", "paid", "2026-08-10"],
    ]);
  });

  it("FLW-38@PoC FR 1: before the day the payment was added nothing is shown (BUD-07 EC4)", () => {
    const { p, t } = payment({ anchorDate: "2026-10-10", createdOn: "2026-11-01" });
    expect(chargesOfFinishedMonth(p, t, "2026-10")).toEqual([]);
  });
});
