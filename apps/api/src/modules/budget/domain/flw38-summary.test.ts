import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { periodSummary, regularPaymentsOf, savingsRatePercent, type SummaryCharge } from "./index.ts";

/**
 * FLW-38@PoC (S-135 «Підсумок періоду»): the cards over the categories of a finished period — income and expenses
 * against the plan, the net flow, the savings rate — and the month's card «Регулярні платежі». Pure rules; every amount
 * is synthetic.
 */
const eur = (a: string) => Money.of(a, "EUR");
const text = (m: Money) => m.toDecimalString();

const figures = (more: Partial<Parameters<typeof periodSummary>[0]> = {}) => ({
  incomePlan: eur("4000"),
  incomeActual: eur("4000"),
  limits: eur("3000"),
  spentLimited: eur("3100"),
  outsidePlan: eur("0"),
  ...more,
});

describe("FLW-38@PoC: income, expenses, net flow and savings rate of a finished period", () => {
  it("FLW-38@PoC AC5: income 4 000 €, expenses 3 100 € — net flow 900 €, savings rate 22,5 %", () => {
    const s = periodSummary(figures());
    expect(text(s.netFlow)).toBe("900");
    expect(s.netFlow.currency).toBe("EUR");
    expect(s.savingsRate).toBe("22.5");
  });

  it("FLW-38@PoC FR 1: plan against fact — income and expenses with the plan and the difference; expenses include «Поза планом»", () => {
    // S-135 board: income 5 550 € against 5 500 €, expenses 3 144,46 € against 3 000 €, net flow 2 405,54 €, 43,3 %.
    const s = periodSummary(
      figures({
        incomePlan: eur("5500"),
        incomeActual: eur("5550"),
        limits: eur("3000"),
        spentLimited: eur("3100.00"),
        outsidePlan: eur("44.46"),
      }),
    );
    expect([text(s.income.actual), text(s.income.plan), text(s.income.difference)]).toEqual([
      "5550",
      "5500",
      "50",
    ]);
    expect([text(s.expenses.actual), text(s.expenses.plan), text(s.expenses.difference)]).toEqual([
      "3144.46",
      "3000",
      "144.46",
    ]);
    expect(text(s.netFlow)).toBe("2405.54");
    expect(s.savingsRate).toBe("43.3");
  });

  it("FLW-38@PoC FR 1: below the plan the difference is negative; spent more than earned — a negative net flow and rate", () => {
    const s = periodSummary(figures({ incomeActual: eur("2000"), spentLimited: eur("2500") }));
    expect(text(s.income.difference)).toBe("-2000");
    expect(text(s.netFlow)).toBe("-500");
    expect(s.savingsRate).toBe("-25.0");
  });

  it("FLW-38@PoC EC1: without income the savings rate is «–» (null); a negative income too", () => {
    expect(periodSummary(figures({ incomeActual: eur("0") })).savingsRate).toBeNull();
    expect(savingsRatePercent(eur("-10"), eur("5"))).toBeNull();
  });

  it("FLW-38@PoC FR 1: one digit after the point, half to even, in exact decimals", () => {
    // 10 ÷ 4 000 = 0,25 % → 0,2; 14 ÷ 4 000 = 0,35 % → 0,4 (half to even).
    expect(savingsRatePercent(eur("4000"), eur("3990"))).toBe("0.2");
    expect(savingsRatePercent(eur("4000"), eur("3986"))).toBe("0.4");
    // A third: 0.1 + 0.2 never drifts (no floats).
    expect(savingsRatePercent(eur("0.3"), eur("0.2"))).toBe("33.3");
  });
});

const charge = (dueOn: string, status: SummaryCharge["status"], more: Partial<SummaryCharge> = {}) =>
  ({
    paymentId: `p-${dueOn}`,
    type: "expense",
    categoryId: null,
    dueOn,
    expected: eur("10"),
    status,
    overdueDays: null,
    paidOn: status === "paid" || status === "paid-late" ? dueOn : null,
    ...more,
  }) satisfies SummaryCharge;

describe("FLW-38@PoC FR 1: the card «Регулярні платежі» of a finished period", () => {
  it("FLW-38@PoC FR 1: «сплачено N з M · K із запізненням» over the expense payments' charges, by date", () => {
    const r = regularPaymentsOf([
      charge("2026-10-25", "paid"),
      charge("2026-10-10", "paid-late", { paidOn: "2026-11-12" }),
      charge("2026-10-01", "paid"),
      charge("2026-10-14", "overdue", { overdueDays: 35 }),
      charge("2026-10-20", "skipped"),
      // A regular income is the income card's, not this one's.
      charge("2026-10-05", "paid", { type: "income" }),
    ]);
    expect(r.items.map((c) => [c.dueOn, c.status])).toEqual([
      ["2026-10-01", "paid"],
      ["2026-10-10", "paid-late"],
      ["2026-10-14", "overdue"],
      ["2026-10-20", "skipped"],
      ["2026-10-25", "paid"],
    ]);
    expect({ count: r.count, paid: r.paid, late: r.late, missed: r.missed }).toEqual({
      count: 5,
      paid: 3,
      late: 1,
      missed: 2,
    });
    expect(r.items[1]!.paidOn).toBe("2026-11-12");
  });

  it("FLW-38@PoC FR 1: no charges — an empty card, not an unknown one", () => {
    expect(regularPaymentsOf([])).toEqual({ count: 0, paid: 0, late: 0, missed: 0, items: [] });
  });
});
