import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { CHARGES_A_YEAR, loanCharges, monthlyInterest } from "./index.ts";

const eur = (amount: string) => Money.of(amount, "EUR");
const brief = (c: ReturnType<typeof loanCharges>[number]) => [
  c.dueOn,
  c.status,
  c.overdueDays,
  c.transactionId,
];

describe("BUD-07@PoC FR 16: the monthly payment of a «Кредит» account (domain)", () => {
  it("BUD-07@PoC FR 16: once a month, on the day of the latest payment to the account; a month without that day — its last day", () => {
    const charges = loanCharges(
      "loan",
      eur("250"),
      [{ transactionId: "t1", date: "2026-10-31" }],
      "2026-10-01",
      "2027-03-31",
      "2026-11-18",
    );
    expect(charges.map((c) => c.dueOn)).toEqual([
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
    expect(charges.every((c) => c.expected.equals(eur("250")))).toBe(true);
  });

  it("BUD-07@PoC FR 16: without any payment to the account — the 1st of each month", () => {
    expect(loanCharges("loan", eur("250"), [], "2026-11-01", "2026-12-31", "2026-11-18").map(brief)).toEqual([
      ["2026-11-01", "overdue", 17, null],
      ["2026-12-01", "expected", null, null],
    ]);
  });

  it("BUD-07@PoC FR 16: a month is paid by its first payment to the account; unpaid — «Очікується» while the window ± 3 days is open, then «Прострочено»", () => {
    const payments = [
      { transactionId: "t-oct", date: "2026-10-10" },
      { transactionId: "t-nov-2", date: "2026-11-12" },
      { transactionId: "t-nov-1", date: "2026-11-02" },
    ];
    // The latest payment, 12 November, gives the day.
    expect(
      loanCharges("loan", eur("250"), payments, "2026-10-01", "2026-12-31", "2026-11-18").map(brief),
    ).toEqual([
      ["2026-10-12", "paid", null, "t-oct"],
      ["2026-11-12", "paid", null, "t-nov-1"],
      ["2026-12-12", "expected", null, null],
    ]);
    const unpaid = [{ transactionId: "t-oct", date: "2026-10-15" }];
    expect(
      loanCharges("loan", eur("250"), unpaid, "2026-11-01", "2026-11-30", "2026-11-18").map(brief),
    ).toEqual([["2026-11-15", "expected", null, null]]);
    expect(
      loanCharges("loan", eur("250"), unpaid, "2026-11-01", "2026-11-30", "2026-11-19").map(brief),
    ).toEqual([["2026-11-15", "overdue", 4, null]]);
  });

  it("BUD-07@PoC FR 16: a payment dated after today pays nothing yet and gives no day", () => {
    const later = [{ transactionId: "t", date: "2026-11-25" }];
    expect(
      loanCharges("loan", eur("250"), later, "2026-11-01", "2026-11-30", "2026-11-18").map(brief),
    ).toEqual([["2026-11-01", "overdue", 17, null]]);
  });

  it("BUD-07@PoC FR 16: no payment is due before the account was opened", () => {
    expect(
      loanCharges("loan", eur("250"), [], "2025-10-01", "2026-01-31", "2026-11-18", "2026-01-01").map((c) => [
        c.dueOn,
        c.status,
      ]),
    ).toEqual([["2026-01-01", "overdue"]]);
    expect(
      loanCharges("loan", eur("250"), [], "2026-11-01", "2026-11-30", "2026-11-18", "2026-11-10"),
    ).toEqual([]);
  });

  it("BUD-07@PoC FR 16: only the charges within the range", () => {
    const payments = [{ transactionId: "t", date: "2026-10-20" }];
    expect(
      loanCharges("loan", eur("250"), payments, "2026-11-21", "2026-12-19", "2026-11-18").map((c) => c.dueOn),
    ).toEqual([]);
    expect(
      loanCharges("loan", eur("250"), payments, "2026-11-20", "2026-12-20", "2026-11-18").map((c) => c.dueOn),
    ).toEqual(["2026-11-20", "2026-12-20"]);
  });

  it("BUD-07@PoC FR 16: the interest — the debt before the payment × the annual rate ÷ 12, to the cent half to even (owner decision 2026-11-16)", () => {
    expect(monthlyInterest(eur("9000"), "12").toDecimalString()).toBe("90");
    expect(monthlyInterest(eur("8750"), "4.2").toDecimalString()).toBe("30.62"); // 30.625 → to even, not 30.63
    expect(monthlyInterest(eur("1"), "6").toDecimalString()).toBe("0"); // 0.005 → 0.00, not 0.01
    expect(monthlyInterest(eur("3"), "6").toDecimalString()).toBe("0.02"); // 0.015 → 0.02
    // Nothing owed (an overpaid loan): no interest.
    expect(monthlyInterest(eur("-10"), "12").toDecimalString()).toBe("0");
  });
});

describe("BUD-07@PoC FR 7: «За рік»", () => {
  it("BUD-07@PoC FR 7: a year holds 52 weekly, 26 two-weekly, 12 monthly, 4 quarterly and 1 yearly charge", () => {
    expect(CHARGES_A_YEAR).toEqual({ week: 52, "two-weeks": 26, month: 12, quarter: 4, year: 1 });
  });
});
