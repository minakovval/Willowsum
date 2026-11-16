import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  addMonths,
  monthlyInterest,
  MONTHS_MAX,
  paidPercent,
  planDeviation,
  simulate,
  simulateStrategy,
  type Assumptions,
} from "./payoff.ts";

const eur = (a: string) => Money.of(a, "EUR");
const visa = (extra: Partial<Assumptions> = {}): Assumptions => ({
  balance: eur("5000"),
  annualRate: "24",
  monthlyPayment: eur("250"),
  extraMonthly: eur("0"),
  oneOffs: [],
  ...extra,
});

function paid<T extends { kind: string }>(o: T): Extract<T, { kind: "paid" }> {
  expect(o.kind).toBe("paid");
  return o as Extract<T, { kind: "paid" }>;
}

describe("BUD-19@PoC: one debt month by month", () => {
  it("BUD-19@PoC FR 3: the month's interest is balance × rate ÷ 12 rounded to the cent half up", () => {
    expect(monthlyInterest(eur("5000"), "24").toJSON()).toEqual({ amount: "100", currency: "EUR" });
    // 1 000.25 × 1 % = 10.0025 → 10.00; 0.50 × 1 % = 0.005 → 0.01 (half up, not to even).
    expect(monthlyInterest(eur("1000.25"), "12").toDecimalString()).toBe("10");
    expect(monthlyInterest(eur("0.5"), "12").toDecimalString()).toBe("0.01");
    // A currency without minor units rounds to the whole unit.
    expect(monthlyInterest(Money.of("150", "JPY"), "12").toDecimalString()).toBe("2");
  });

  it("BUD-19@PoC AC1: «Visa» 5 000 € at 24 % with 250 € / month — 26 months, interest 1 449,37 €", () => {
    const r = paid(simulate(visa()));
    expect(r.months).toBe(26);
    expect(r.totalInterest.toDecimalString()).toBe("1449.37");
    expect(r.balances).toHaveLength(26);
    expect(r.balances.at(-1)!.isZero()).toBe(true);
    // The last payment is smaller: what is left with its interest.
    expect(r.balances.at(-2)!.compare(eur("250"))).toBe(-1);
  });

  it("BUD-19@PoC AC2: an extra 100 € / month — 17 months, 946,99 €; 9 months earlier, 502,38 € saved", () => {
    const base = paid(simulate(visa()));
    const extra = paid(simulate(visa({ extraMonthly: eur("100") })));
    expect(extra.months).toBe(17);
    expect(extra.totalInterest.toDecimalString()).toBe("946.99");
    expect(base.months - extra.months).toBe(9);
    expect(base.totalInterest.minus(extra.totalInterest).toDecimalString()).toBe("502.38");
  });

  it("BUD-19@PoC AC4: 5 000 € at 24 % and a payment of 90 € (interest 100 €) — the debt does not decrease", () => {
    expect(simulate(visa({ monthlyPayment: eur("90") }))).toEqual({ kind: "not-decreasing" });
  });

  it("BUD-19@PoC EC1: a payment equal to the month's interest does not decrease the debt either", () => {
    expect(simulate(visa({ monthlyPayment: eur("100") }))).toEqual({ kind: "not-decreasing" });
    // The extra payment counts: 90 € + 20 € covers the interest.
    expect(simulate(visa({ monthlyPayment: eur("90"), extraMonthly: eur("20") })).kind).toBe("paid");
  });

  it("BUD-19@PoC EC6: a calculation longer than 1 200 months stops with over-limit", () => {
    // 5,01 € against 5 € of interest a month at 1,2 %: the debt falls by about a cent a month.
    expect(simulate(visa({ annualRate: "1.2", monthlyPayment: eur("5.01") }))).toEqual({
      kind: "over-limit",
    });
    expect(MONTHS_MAX).toBe(1200);
  });

  it("BUD-19@PoC FR 3: a 0 % rate has no interest; the last payment is the rest", () => {
    const r = paid(simulate(visa({ annualRate: "0", monthlyPayment: eur("300") })));
    expect(r.months).toBe(17);
    expect(r.totalInterest.isZero()).toBe(true);
    expect(r.balances.at(-2)!.toDecimalString()).toBe("200");
  });

  it("BUD-19@PoC EC5: a one-off payment larger than the balance left is capped to it", () => {
    const r = paid(simulate(visa({ oneOffs: [{ month: 2, amount: eur("9000") }] })));
    expect(r.months).toBe(2);
    expect(r.cappedOneOffs).toEqual([2]);
    const small = paid(simulate(visa({ oneOffs: [{ month: 1, amount: eur("1000") }] })));
    expect(small.cappedOneOffs).toEqual([]);
    expect(small.months).toBeLessThan(26);
  });

  it("BUD-19@PoC FR 4: a debt already paid off needs no months", () => {
    expect(paid(simulate(visa({ balance: eur("0") }))).months).toBe(0);
  });

  it("month arithmetic crosses years", () => {
    expect(addMonths("2026-11", 26)).toBe("2029-01");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });
});

describe("BUD-19@PoC: «Стратегія»", () => {
  const debts = [
    { id: "visa", balance: eur("5000"), annualRate: "24", minimumPayment: eur("100") },
    { id: "mastercard", balance: eur("1500"), annualRate: "18", minimumPayment: eur("40") },
  ];

  it("BUD-19@PoC AC3: Avalanche — 24 months, 1 581,52 €; Snowball — 25 months, 1 728,58 €, Mastercard closed earlier; 147,06 €", () => {
    const avalanche = paid(simulateStrategy(debts, eur("340"), "avalanche"));
    const snowball = paid(simulateStrategy(debts, eur("340"), "snowball"));
    expect([avalanche.months, avalanche.totalInterest.toDecimalString()]).toEqual([24, "1581.52"]);
    expect([snowball.months, snowball.totalInterest.toDecimalString()]).toEqual([25, "1728.58"]);
    expect(snowball.closedIn.get("mastercard")!).toBeLessThan(avalanche.closedIn.get("mastercard")!);
    expect(snowball.totalInterest.minus(avalanche.totalInterest).toDecimalString()).toBe("147.06");
  });

  it("BUD-19@PoC FR 6: a total that does not exceed the month's interest does not decrease the debts", () => {
    expect(simulateStrategy(debts, eur("122.5"), "avalanche")).toEqual({ kind: "not-decreasing" });
  });

  it("BUD-19@PoC FR 6: debts at 0 % are paid by their minimums and the rest", () => {
    const zero = debts.map((d) => ({ ...d, annualRate: "0" }));
    const r = paid(simulateStrategy(zero, eur("650"), "snowball"));
    expect(r.months).toBe(10);
    expect(r.totalInterest.isZero()).toBe(true);
  });
});

describe("BUD-19@PoC: «Прогрес»", () => {
  it("BUD-19@PoC FR 7: «Погашено N %» of the start balance, rounded down", () => {
    expect(paidPercent(eur("5000"), eur("4100"))).toBe(18);
    expect(paidPercent(eur("5000"), eur("0"))).toBe(100);
    expect(paidPercent(eur("5000"), eur("-10"))).toBe(100);
    expect(paidPercent(eur("0"), eur("0"))).toBe(0);
    expect(paidPercent(eur("5000"), eur("6000"))).toBe(0);
  });

  it("BUD-19@PoC FR 7: the «План» column — ahead, on plan or behind by the difference", () => {
    // The plan pays off 150 € this month (5 000 → 4 850).
    expect(planDeviation(eur("5000"), eur("4850"), eur("5000"), eur("4800")).status).toBe("ahead");
    expect(planDeviation(eur("5000"), eur("4850"), eur("5000"), eur("4800")).amount.toDecimalString()).toBe(
      "50",
    );
    expect(planDeviation(eur("5000"), eur("4850"), eur("5000"), eur("4850")).status).toBe("on-track");
    const behind = planDeviation(eur("5000"), eur("4850"), eur("5000"), eur("4900"));
    expect([behind.status, behind.amount.toDecimalString()]).toEqual(["behind", "50"]);
  });
});
