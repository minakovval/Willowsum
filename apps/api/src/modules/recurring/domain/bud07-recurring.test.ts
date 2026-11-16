import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { addDays, detectSeries, nextDate, scheduleDate, type Charge } from "./index.ts";

/** BUD-07@PoC a) (wave 2 row 25): the detection of series and the next date — pure rules. Amounts are synthetic. */

let seq = 0;
function charge(date: string, amount: string, currency = "EUR"): Charge {
  seq += 1;
  return { id: `c${String(seq).padStart(4, "0")}`, date, amount: Money.of(amount, currency) };
}

/** Charges every `days` days from `start`, one amount each. */
function every(start: string, days: number, amounts: readonly string[]): Charge[] {
  return amounts.map((a, i) => charge(addDays(start, days * i), a));
}

const summary = (charges: readonly Charge[]) =>
  detectSeries(charges).map((s) => ({
    frequency: s.frequency,
    variable: s.variable,
    count: s.charges.length,
    expected: s.expected.toDecimalString(),
  }));

describe("BUD-07@PoC FR 2: a series — the intervals fit a frequency and the amount is within ± 10 %", () => {
  it("BUD-07@PoC AC1: three charges to one merchant ≈ 30 days apart with a close amount — a monthly payment", () => {
    const charges = [
      charge("2026-08-14", "15.49"),
      charge("2026-09-14", "15.49"),
      charge("2026-10-13", "16.20"),
    ];
    expect(summary(charges)).toEqual([{ frequency: "month", variable: false, count: 3, expected: "16.2" }]);
  });

  it("BUD-07@PoC FR 2: every frequency at both ends of its interval; outside it — no series", () => {
    expect(summary(every("2026-09-01", 6, ["5", "5", "5"]))[0]?.frequency).toBe("week");
    expect(summary(every("2026-09-01", 8, ["5", "5", "5"]))[0]?.frequency).toBe("week");
    expect(summary(every("2026-09-01", 12, ["5", "5", "5"]))[0]?.frequency).toBe("two-weeks");
    expect(summary(every("2026-09-01", 16, ["5", "5", "5"]))[0]?.frequency).toBe("two-weeks");
    expect(summary(every("2026-01-01", 26, ["5", "5", "5"]))[0]?.frequency).toBe("month");
    expect(summary(every("2026-01-01", 35, ["5", "5", "5"]))[0]?.frequency).toBe("month");
    expect(summary(every("2025-01-01", 85, ["5", "5", "5"]))[0]?.frequency).toBe("quarter");
    expect(summary(every("2025-01-01", 97, ["5", "5", "5"]))[0]?.frequency).toBe("quarter");
    expect(summary(every("2024-01-01", 355, ["5", "5"]))[0]?.frequency).toBe("year");
    expect(summary(every("2024-01-01", 375, ["5", "5"]))[0]?.frequency).toBe("year");
    for (const days of [5, 9, 11, 17, 25, 36, 84, 98, 354, 376])
      expect(summary(every("2024-01-01", days, ["5", "5", "5"]))).toEqual([]);
  });

  it("BUD-07@PoC FR 2: the fewest charges — 3 for a week, 2 weeks, a month and a quarter; 2 for a year", () => {
    expect(summary(every("2026-09-01", 7, ["5", "5"]))).toEqual([]);
    expect(summary(every("2026-09-01", 14, ["5", "5"]))).toEqual([]);
    expect(summary(every("2026-08-01", 30, ["5", "5"]))).toEqual([]);
    expect(summary(every("2026-01-01", 91, ["5", "5"]))).toEqual([]);
    expect(summary(every("2025-01-01", 365, ["5"]))).toEqual([]);
  });

  it("BUD-07@PoC AC6: a yearly subscription with two charges 365 days apart — a yearly payment", () => {
    expect(summary([charge("2025-03-02", "59.99"), charge("2026-03-02", "59.99")])).toEqual([
      { frequency: "year", variable: false, count: 2, expected: "59.99" },
    ]);
  });

  it("BUD-07@PoC FR 2: ± 10 % — 90 and 110 are one price; 89 and 110 are not", () => {
    expect(summary(every("2026-07-01", 30, ["90", "100", "110"]))[0]).toMatchObject({ variable: false });
    expect(summary(every("2026-07-01", 30, ["89", "100", "110"]))[0]).toMatchObject({ variable: true });
  });

  it("BUD-07@PoC FR 2: a merchant paid on most days at one price is no series of some of its days", () => {
    const days = Array.from({ length: 120 }, (_, i) => charge(addDays("2026-07-01", i), "4.80"));
    expect(summary(days)).toEqual([]);
  });

  it("BUD-07@PoC FR 2: one interval out of range ends the series; the latest run of the series is proposed", () => {
    // Three months, a gap of 70 days, three months again: the series since the gap.
    const before = every("2026-01-05", 30, ["12", "12", "12"]);
    const after = every(addDays(before.at(-1)!.date, 70), 30, ["12", "12", "12"]);
    const found = detectSeries([...before, ...after]);
    expect(found.map((s) => s.charges.map((c) => c.id))).toEqual([after.map((c) => c.id)]);
  });
});

describe("BUD-07@PoC FR 3: a variable series; several series of one merchant at different prices", () => {
  it("BUD-07@PoC EC1: utilities with a varying amount (largest ÷ smallest ≤ 2,5) — «змінна», expected = the average of the last 3", () => {
    const utilities = every("2026-05-10", 31, ["40.00", "70.00", "55.00", "90.00"]);
    expect(summary(utilities)).toEqual([{ frequency: "month", variable: true, count: 4, expected: "71.67" }]);
  });

  it("BUD-07@PoC FR 3: largest ÷ smallest above 2,5 — no variable series", () => {
    expect(summary(every("2026-05-10", 31, ["30.00", "80.00", "30.00", "80.00"]))).toEqual([]);
  });

  it("BUD-07@PoC FR 3: two subscriptions of one merchant at different prices are proposed separately", () => {
    const basic = every("2026-06-01", 30, ["9.99", "9.99", "9.99", "9.99"]);
    const family = every("2026-06-15", 30, ["14.99", "14.99", "14.99", "14.99"]);
    expect(summary([...family, ...basic])).toEqual([
      { frequency: "month", variable: false, count: 4, expected: "9.99" },
      { frequency: "month", variable: false, count: 4, expected: "14.99" },
    ]);
  });

  it("BUD-07@PoC FR 3: a price that went up and has charged 3 times since — one series at the new price", () => {
    const old = every("2026-01-30", 30, ["9.99", "9.99", "9.99", "9.99", "9.99"]);
    const raised = every(addDays(old.at(-1)!.date, 30), 30, ["11.99", "11.99", "11.99"]);
    expect(summary([...old, ...raised])).toEqual([
      { frequency: "month", variable: false, count: 3, expected: "11.99" },
    ]);
  });

  it("BUD-07@PoC FR 3: a price that went up once — one variable series of all the charges", () => {
    const charges = every("2026-05-30", 30, ["9.99", "9.99", "9.99", "11.99"]);
    expect(summary(charges)).toEqual([{ frequency: "month", variable: true, count: 4, expected: "10.66" }]);
  });

  it("BUD-07@PoC FR 2: the same charges always give the same series, whatever their order", () => {
    const charges = [
      ...every("2026-06-01", 30, ["9.99", "9.99", "9.99"]),
      ...every("2026-06-15", 30, ["14.99", "14.99", "14.99"]),
    ];
    expect(detectSeries([...charges].reverse())).toEqual(detectSeries(charges));
  });
});

describe("BUD-07@PoC FR 4: the date of a proposal — the next date of the schedule", () => {
  it("BUD-07@PoC FR 4: a month counts from the anchor; a day the month lacks is its last day", () => {
    expect(scheduleDate("2027-01-31", "month", 1)).toBe("2027-02-28");
    expect(scheduleDate("2027-01-31", "month", 2)).toBe("2027-03-31");
    expect(scheduleDate("2028-01-31", "month", 1)).toBe("2028-02-29");
    expect(scheduleDate("2024-02-29", "year", 1)).toBe("2025-02-28");
    expect(scheduleDate("2026-11-30", "quarter", 1)).toBe("2027-02-28");
    expect(scheduleDate("2026-11-16", "week", 2)).toBe("2026-11-30");
    expect(scheduleDate("2026-11-16", "two-weeks", 1)).toBe("2026-11-30");
  });

  it("BUD-07@PoC FR 4: the next date on or after a day — the anchor when it is not before it", () => {
    expect(nextDate("2026-10-13", "month", "2026-11-16")).toBe("2026-12-13");
    expect(nextDate("2026-10-16", "month", "2026-11-16")).toBe("2026-11-16");
    expect(nextDate("2026-12-01", "month", "2026-11-16")).toBe("2026-12-01");
    expect(nextDate("2025-03-02", "year", "2026-11-16")).toBe("2027-03-02");
    expect(nextDate("2026-11-02", "week", "2026-11-16")).toBe("2026-11-16");
    expect(nextDate("2026-11-03", "week", "2026-11-16")).toBe("2026-11-17");
    expect(nextDate("2024-01-31", "month", "2026-11-16")).toBe("2026-11-30");
  });
});
