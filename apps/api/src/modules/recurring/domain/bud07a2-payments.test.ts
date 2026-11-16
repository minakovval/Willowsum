import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  checkPayment,
  daysBetween,
  detectSeries,
  intervalFits,
  isFresh,
  isRejected,
  nextDate,
  scheduleDate,
  type FoundSeries,
  type PaymentInput,
} from "./index.ts";

/** BUD-07@PoC a2) (wave 2 row 25): freshness, the leap year, the fields of a payment, rejected series. Synthetic data. */

describe("BUD-07@PoC FR 2: a series is proposed only while its latest charge is no older than one interval + 3 days", () => {
  it("BUD-07@PoC EC3: a monthly series charged on 10 September is proposed until 13 October inclusive", () => {
    expect(isFresh("2026-09-10", "month", "2026-10-13")).toBe(true);
    expect(isFresh("2026-09-10", "month", "2026-10-14")).toBe(false);
  });

  it("BUD-07@PoC FR 2: a week — 7 days, 2 weeks — 14 days, a quarter and a year — 3 and 12 calendar months, + 3 days", () => {
    expect(isFresh("2026-11-01", "week", "2026-11-11")).toBe(true);
    expect(isFresh("2026-11-01", "week", "2026-11-12")).toBe(false);
    expect(isFresh("2026-10-20", "two-weeks", "2026-11-06")).toBe(true);
    expect(isFresh("2026-10-20", "two-weeks", "2026-11-07")).toBe(false);
    expect(isFresh("2026-08-31", "quarter", "2026-12-03")).toBe(true);
    expect(isFresh("2026-08-31", "quarter", "2026-12-04")).toBe(false);
    expect(isFresh("2025-11-16", "year", "2026-11-19")).toBe(true);
    expect(isFresh("2025-11-16", "year", "2026-11-20")).toBe(false);
    // A month from 31 January is 28 February (the month's last day), + 3 days.
    expect(isFresh("2027-01-31", "month", "2027-03-03")).toBe(true);
    expect(isFresh("2027-01-31", "month", "2027-03-04")).toBe(false);
  });
});

describe("BUD-07@PoC FR 4: the schedule across a leap year (#315, п. 13)", () => {
  it("BUD-07@PoC FR 4: anchored at 29 February — 28 February in common years, 29 February again in a leap year", () => {
    expect([1, 2, 3, 4].map((k) => scheduleDate("2024-02-29", "year", k))).toEqual([
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
    expect(nextDate("2024-02-29", "year", "2028-01-01")).toBe("2028-02-29");
    expect(scheduleDate("2028-01-31", "month", 1)).toBe("2028-02-29");
    expect(scheduleDate("2028-01-31", "month", 2)).toBe("2028-03-31");
    expect(scheduleDate("2027-11-30", "quarter", 1)).toBe("2028-02-29");
    // Days and weeks go through 29 February as through any day.
    expect(scheduleDate("2028-02-22", "week", 1)).toBe("2028-02-29");
    expect(daysBetween("2028-02-01", "2028-03-01")).toBe(29);
  });

  it("BUD-07@PoC FR 2: a year with 29 February is 366 days — still a yearly interval; a yearly series across it is found", () => {
    expect(daysBetween("2027-03-01", "2028-03-01")).toBe(366);
    expect(intervalFits("2027-03-01", "2028-03-01", "year")).toBe(true);
    const found = detectSeries([
      { id: "a", date: "2027-03-01", amount: Money.of("49.00", "EUR") },
      { id: "b", date: "2028-03-01", amount: Money.of("49.00", "EUR") },
    ]);
    expect(found.map((s) => s.frequency)).toEqual(["year"]);
    expect(isFresh("2028-03-01", "year", "2029-03-04")).toBe(true);
    expect(isFresh("2028-02-29", "year", "2029-03-03")).toBe(true);
    expect(isFresh("2028-02-29", "year", "2029-03-04")).toBe(false);
  });
});

const manual: PaymentInput = {
  name: "  Оренда квартири  ",
  amount: { amount: "650.00", currency: "EUR" },
  frequency: "month",
  anchorDate: "2026-11-05",
  type: "expense",
};

describe("BUD-07@PoC FR 6: a payment added by hand — its fields", () => {
  it("BUD-07@PoC FR 6: name, amount, frequency, anchor date, type; category, account, end date, «Підписка», «Змінна сума» optional", () => {
    const checked = checkPayment(manual);
    expect(checked.kind).toBe("ok");
    if (checked.kind !== "ok") return;
    expect(checked.fields).toMatchObject({
      name: "Оренда квартири",
      frequency: "month",
      anchorDate: "2026-11-05",
      categoryId: null,
      accountId: null,
      endDate: null,
      type: "expense",
      subscription: false,
      variable: false,
    });
    expect(checked.fields.expected.toJSON()).toEqual({ amount: "650", currency: "EUR" });
  });

  it("BUD-07@PoC FR 6: an empty or long name, a zero or over-precise amount, a bad date, an end before the anchor — refused", () => {
    const issues = (input: Partial<PaymentInput>) => {
      const r = checkPayment({ ...manual, ...input });
      return r.kind === "invalid" ? r.issues : [];
    };
    expect(issues({ name: " " })).toEqual([{ field: "name", issue: "required" }]);
    expect(issues({ name: "н".repeat(61) })).toEqual([{ field: "name", issue: "too_long" }]);
    expect(issues({ amount: { amount: "0", currency: "EUR" } })).toEqual([
      { field: "amount", issue: "invalid" },
    ]);
    expect(issues({ amount: { amount: "1.005", currency: "EUR" } })).toEqual([
      { field: "amount", issue: "invalid" },
    ]);
    expect(issues({ amount: { amount: "-5", currency: "EUR" } })).toEqual([
      { field: "amount", issue: "invalid" },
    ]);
    expect(issues({ anchorDate: "2026-02-30" })).toEqual([{ field: "anchorDate", issue: "invalid" }]);
    expect(issues({ endDate: "2026-11-04" })).toEqual([{ field: "endDate", issue: "before_anchor" }]);
    expect(issues({ endDate: "2026-11-05" })).toEqual([]);
  });
});

const rejected = {
  merchantId: "m1",
  type: "expense" as const,
  frequency: "month" as const,
  variable: false,
  expected: Money.of("9.99", "EUR"),
  transactionIds: ["t1", "t2", "t3"],
};

const found = (extra: Partial<FoundSeries> = {}): FoundSeries => ({
  merchantId: "m1",
  type: "expense",
  frequency: "month",
  variable: false,
  expected: Money.of("9.99", "EUR"),
  transactionIds: ["t7", "t8", "t9"],
  ...extra,
});

describe("BUD-07@PoC FR 4: «Не регулярний» — the series is not proposed again, matched by more than its key (#315, п. 8)", () => {
  it("BUD-07@PoC FR 4: a charge in common is the same series, whatever its price now", () => {
    expect(
      isRejected(found({ transactionIds: ["t3", "t4"], expected: Money.of("12.99", "EUR") }), rejected),
    ).toBe(true);
  });

  it("BUD-07@PoC FR 4: once its first charges left the 430 days — the same merchant, frequency and price (± 10 %)", () => {
    expect(isRejected(found(), rejected)).toBe(true);
    expect(isRejected(found({ expected: Money.of("10.98", "EUR") }), rejected)).toBe(true);
    expect(isRejected(found({ expected: Money.of("11.00", "EUR") }), rejected)).toBe(false);
  });

  it("BUD-07@PoC FR 3: another price, frequency, type, currency or merchant is another series — still proposed", () => {
    expect(isRejected(found({ expected: Money.of("14.99", "EUR") }), rejected)).toBe(false);
    expect(isRejected(found({ frequency: "year" }), rejected)).toBe(false);
    expect(isRejected(found({ type: "income" }), rejected)).toBe(false);
    expect(isRejected(found({ expected: Money.of("9.99", "USD") }), rejected)).toBe(false);
    expect(isRejected(found({ merchantId: "m2" }), rejected)).toBe(false);
    expect(isRejected(found({ variable: true }), rejected)).toBe(false);
    expect(isRejected(found({ variable: true }), { ...rejected, variable: true })).toBe(true);
  });
});
