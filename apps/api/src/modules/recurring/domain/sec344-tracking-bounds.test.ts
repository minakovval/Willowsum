import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { daysBetween, FREQUENCIES } from "./schedule.ts";
import {
  canSettle,
  canSkip,
  CHARGE_STATUSES,
  trackPayment,
  type Candidate,
  type TrackInput,
} from "./tracking.ts";

/**
 * Security review of PR #344 (BUD-07@PoC b1): the cost of tracking one payment does not depend on how far its anchor
 * date is from today — one request must not hold the API's only thread (NFR-14: availability for every space).
 */
const input = (over: Partial<TrackInput>): TrackInput => ({
  frequency: "week",
  anchorDate: "2026-10-05",
  endDate: null,
  createdOn: "2026-10-01",
  keptOn: null,
  type: "expense",
  base: Money.of("10.00", "EUR"),
  variable: false,
  marks: new Map(),
  candidates: [],
  from: "2025-09-13",
  today: "2026-11-16",
  ...over,
});

describe("sec344 BUD-07@PoC FR 8: a payment's schedule is found without walking from its anchor date", () => {
  it("BUD-07@PoC FR 8: an anchor in 9999 or in 0100 is tracked as fast as one of this year", () => {
    const started = performance.now();
    for (const frequency of FREQUENCIES)
      for (const anchorDate of ["9999-12-27", "0100-01-01", "9999-12-31", "0100-02-28"])
        trackPayment(input({ frequency, anchorDate }));
    // 20 payments: seconds before the fix (one schedule step at a time), a few milliseconds after.
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("BUD-07@PoC FR 8: the charges of a far anchor are the dates of its schedule, from the first read day through the next one", () => {
    const week = trackPayment(input({ anchorDate: "9999-12-27", createdOn: "2025-01-01" })).charges.map(
      (c) => c.dueOn,
    );
    for (const dueOn of week) expect(daysBetween(dueOn, "9999-12-27") % 7).toBe(0);
    expect(week[0]! >= "2025-09-13" && week[0]! < "2025-09-20").toBe(true);
    expect(week.at(-1)! > "2026-11-16" && week.at(-1)! <= "2026-11-23").toBe(true);
    expect(week).toHaveLength(63);
    // Monthly from 31 January 0100: the day is kept, a shorter month gives its last day.
    const month = trackPayment(
      input({ frequency: "month", anchorDate: "0100-01-31", createdOn: "2025-01-01" }),
    ).charges.map((c) => c.dueOn);
    expect(month[0]).toBe("2025-09-30");
    expect(month.slice(-3)).toEqual(["2026-09-30", "2026-10-31", "2026-11-30"]);
    expect(month).toHaveLength(15);
  });
});

const eur = (a: string) => Money.of(a, "EUR");
let seq = 0;
const paidBy = (amount: string, more: Partial<Candidate> = {}) => {
  seq += 1;
  const candidate: Candidate = {
    id: `s${seq}`,
    date: "2026-07-05",
    amount: eur(amount),
    value: eur(amount),
    converted: false,
    approximate: false,
    merchant: true,
    category: false,
    ...more,
  };
  // Monthly on the 5th from June, 40,00 € expected, added 1 June: the July charge is the first the user had not seen.
  const t = trackPayment(
    input({
      frequency: "month",
      anchorDate: "2026-06-05",
      createdOn: "2026-06-01",
      base: eur("40.00"),
      today: "2026-07-20",
      candidates: [candidate],
    }),
  );
  return { status: t.charges.find((c) => c.dueOn === "2026-07-05")!.status, expected: t.expected };
};

describe("sec344 BUD-07@PoC FR 8, FR 11, FR 12: the limits of the amounts, to the cent", () => {
  it("BUD-07@PoC FR 8: of the merchant — from exactly 0,5 to exactly 2 of the expected amount, not a cent beyond", () => {
    expect(paidBy("20.00").status).toBe("paid");
    expect(paidBy("19.99").status).toBe("overdue");
    expect(paidBy("80.00").status).toBe("paid");
    expect(paidBy("80.01").status).toBe("overdue");
  });

  it("BUD-07@PoC FR 8: of the category — exactly ± 10 % pays, a cent beyond does not", () => {
    const byCategory = { merchant: false, category: true };
    expect(paidBy("44.00", byCategory).status).toBe("paid");
    expect(paidBy("44.01", byCategory).status).toBe("overdue");
    expect(paidBy("36.00", byCategory).status).toBe("paid");
    expect(paidBy("35.99", byCategory).status).toBe("overdue");
  });

  it("BUD-07@PoC FR 11: exactly 5 % off leaves the expected amount; a cent more than 5 % changes it (up and down)", () => {
    expect(paidBy("42.00").expected).toEqual(eur("40.00"));
    expect(paidBy("42.01").expected).toEqual(eur("42.01"));
    expect(paidBy("38.00").expected).toEqual(eur("40.00"));
    expect(paidBy("37.99").expected).toEqual(eur("37.99"));
  });

  it("BUD-07@PoC FR 12: a charge in another currency 8 % off after the conversion pays and never changes the expected amount", () => {
    const usd = { amount: Money.of("47.00", "USD"), value: eur("43.20"), converted: true };
    expect(paidBy("43.20", usd)).toEqual({ status: "paid", expected: eur("40.00") });
  });

  it("BUD-07@PoC FR 20, FR 21: «Позначити пропущеним» only an overdue charge; «Зарахувати» only an overdue or skipped one", () => {
    expect(CHARGE_STATUSES.filter((status) => canSkip({ status }))).toEqual(["overdue"]);
    expect(CHARGE_STATUSES.filter((status) => canSettle({ status }))).toEqual(["overdue", "skipped"]);
  });
});
