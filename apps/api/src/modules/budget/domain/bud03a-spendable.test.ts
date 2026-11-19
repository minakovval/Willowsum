import { describe, expect, it } from "vitest";
import { CurrencyMismatchError, Money } from "@willowsum/domain-kernel";
import { daysLeft, spendable, type LimitLine, type PeriodObligations, type SpendableInput } from "./index.ts";

/** BUD-03@PoC a) (wave 2 row 34): the calculation of «Можна витратити», its daily limit and the five rows of the card. */
const eur = (amount: string) => Money.of(amount, "EUR");
const zero = eur("0");

const line = (categoryId: string, l: string, spent: string, mandatory = false): LimitLine => ({
  categoryId,
  groupId: "g",
  mandatory,
  limit: eur(l),
  spent: eur(spent),
  remaining: eur(l).minus(eur(spent)),
});

const unpaid = (amount: string, categoryId: string | null = null) => ({
  categoryId,
  amount: eur(amount),
  paid: false,
});

/**
 * AC1: the 12th of a 30-day month (November 2026), expected income 6 000 €, spent 2 300 €, unpaid regular payments
 * 1 900 €, planned goal contributions 500 €; no limits — the spending is «Поза планом».
 */
const AC1: SpendableInput = {
  today: "2026-11-12",
  period: "2026-11",
  incomePlan: eur("6000"),
  incomeActual: eur("6000"),
  incomeExpected: zero,
  lines: [],
  outsidePlan: eur("2300"),
  obligations: { recurring: [unpaid("1200"), unpaid("700")], debtMinimums: [] },
  goalContributions: eur("500"),
  plannedExpenses: zero,
  plannedSavings: zero,
};

describe("BUD-03@PoC: the sum «Можна витратити» and the daily limit", () => {
  it("BUD-03@PoC AC1: income 6 000, spent 2 300, unpaid regular payments 1 900, goals 500 on the 12th of a 30-day month — 1 300 € and 68,42 € a day (19 days, today included)", () => {
    const s = spendable(AC1);
    expect(s.amount).toEqual(eur("1300"));
    expect(s.daysLeft).toBe(19);
    expect(s.daily.toDecimalString()).toBe("68.42");
    expect(s.overspend).toBeNull();
  });

  it("BUD-03@PoC AC3: a categorised restaurant transaction of 240 € — 1 060 € and the daily limit 55,78 €", () => {
    const s = spendable({ ...AC1, outsidePlan: eur("2540") });
    expect(s.amount).toEqual(eur("1060"));
    expect(s.daily.toDecimalString()).toBe("55.78");
  });

  it("BUD-03@PoC FR 2: income − spent − unpaid regular payments − goal contributions and planned expenses − the mandatory rest", () => {
    const s = spendable({
      ...AC1,
      lines: [line("groceries", "620", "590", true)],
      outsidePlan: eur("1710"),
      plannedExpenses: eur("100"),
    });
    // 6000 − 2300 − 1900 − 500 − 100 − 30.
    expect(s.amount).toEqual(eur("1170"));
  });

  it("BUD-03@PoC AC9: a mandatory «Продукти» with a limit of 620 € and 590 € spent lowers the sum by 30 € more — «Обов'язкові категорії: ще потрібно 30 €»", () => {
    const s = spendable({ ...AC1, lines: [line("groceries", "620", "590", true)], outsidePlan: eur("1710") });
    expect(s.mandatory).toEqual(eur("30"));
    expect(s.amount).toEqual(eur("1270"));
    expect(s.mini.find((r) => r.row === "mandatory")?.amount).toEqual(eur("30"));
  });

  it("BUD-03@PoC FR 14: a mandatory category's rest less its own unpaid payments, never below 0 — an overspent one adds nothing", () => {
    const s = spendable({
      ...AC1,
      lines: [
        line("rent", "1000", "200", true),
        line("utilities", "100", "150", true),
        line("cafe", "50", "10"),
      ],
      outsidePlan: zero,
      obligations: { recurring: [unpaid("700", "rent"), unpaid("40", "utilities")], debtMinimums: [] },
      goalContributions: zero,
    });
    // rent: 1000 − 200 − 700 = 100; utilities: overspent — 0 (its 40 € are in the regular payments); cafe — optional.
    expect(s.mandatory).toEqual(eur("100"));
    expect(s.regularPayments).toEqual(eur("740"));
    expect(s.spent).toEqual(eur("360"));
  });
});

describe("BUD-03@PoC: expected income", () => {
  it("BUD-03@PoC AC5: plan 6 000, actual 6 400 — the expected income is 6 400; before the income comes — the plan 6 000 «очікується»", () => {
    const came = spendable({ ...AC1, incomeActual: eur("6400") });
    expect(came.income).toMatchObject({ value: eur("6400"), pending: false });
    const not = spendable({ ...AC1, incomeActual: zero });
    expect(not.income).toMatchObject({ value: eur("6000"), pending: true });
    expect(not.amount).toEqual(eur("1300"));
  });

  it("BUD-03@PoC FR 3 boundary: the income that came equals the plan — no «очікується»", () => {
    expect(spendable(AC1).income.pending).toBe(false);
  });

  it("BUD-03@PoC EC1: the income has not come yet — the calculation goes by the plan with «очікується»", () => {
    const s = spendable({ ...AC1, incomeActual: eur("2000") });
    expect(s.income.value).toEqual(eur("6000"));
    expect(s.income.pending).toBe(true);
  });

  it("BUD-03@PoC FR 3: regular incomes still expected in the period are added to the actual income against the plan", () => {
    const s = spendable({ ...AC1, incomeActual: eur("5000"), incomeExpected: eur("1500") });
    expect(s.income).toMatchObject({ expected: eur("6500"), value: eur("6500"), pending: false });
    expect(s.amount).toEqual(eur("1800"));
  });
});

describe("BUD-03@PoC: the daily limit", () => {
  it("BUD-03@PoC FR 4: rounded down to the cent — 100 € over 3 days is 33,33 €, never 33,34 €", () => {
    const s = spendable({
      ...AC1,
      today: "2026-11-28",
      outsidePlan: zero,
      obligations: { recurring: [], debtMinimums: [] },
      goalContributions: eur("5900"),
    });
    expect(s.amount).toEqual(eur("100"));
    expect(s.daysLeft).toBe(3);
    expect(s.daily.toDecimalString()).toBe("33.33");
  });

  it("BUD-03@PoC FR 4: a currency without cents — 100 ¥ over 3 days is 33 ¥, never 33,33 ¥", () => {
    const jpy = (a: string) => Money.of(a, "JPY");
    const none = { incomeExpected: jpy("0"), outsidePlan: jpy("0"), goalContributions: jpy("0") };
    const s = spendable({
      ...{ ...AC1, ...none, plannedExpenses: jpy("0"), plannedSavings: jpy("0") },
      ...{ today: "2026-11-28", incomePlan: jpy("100"), incomeActual: jpy("100") },
      obligations: { recurring: [], debtMinimums: [] },
    });
    expect(s.daily.toDecimalString()).toBe("33");
  });

  it("BUD-03@PoC AC6: the last day of the period, 90 € left — the daily limit is 90 €", () => {
    const s = spendable({
      ...AC1,
      today: "2026-11-30",
      outsidePlan: eur("5410"),
      obligations: { recurring: [], debtMinimums: [] },
      goalContributions: eur("500"),
    });
    expect(s.amount).toEqual(eur("90"));
    expect(s.daysLeft).toBe(1);
    expect(s.daily).toEqual(eur("90"));
  });

  it("BUD-03@PoC EC2: on the last day the daily limit equals the rest, cents and all", () => {
    const s = spendable({ ...AC1, today: "2026-11-30", outsidePlan: eur("3599.99") });
    expect(s.daily).toEqual(s.amount);
    expect(s.daily.toDecimalString()).toBe("0.01");
  });

  it("BUD-03@PoC FR 4: a negative sum without overspend shows with «−» and the daily limit is 0", () => {
    const s = spendable({ ...AC1, goalContributions: eur("1850") });
    expect(s.amount).toEqual(eur("-50"));
    expect(s.overspend).toBeNull();
    expect(s.daily.isZero()).toBe(true);
    expect(s.daily.toDecimalString()).toBe("0");
  });

  it("BUD-03@PoC FR 4 boundary: the days count from today to the period's last day, both included", () => {
    expect(daysLeft("2026-11-01", "2026-11")).toBe(30);
    expect(daysLeft("2026-02-01", "2026-02")).toBe(28);
    expect(daysLeft("2026-12-31", "2026-12")).toBe(1);
    expect(() => spendable({ ...AC1, today: "2026-12-01" })).toThrow(RangeError);
    expect(() => spendable({ ...AC1, today: "2026-10-31" })).toThrow(RangeError);
  });
});

describe("BUD-03@PoC: overspend", () => {
  it("BUD-03@PoC AC4: a budget of 3 000 € and 3 150 € spent — «Перевитрата 150 €», the daily limit 0 €", () => {
    const s = spendable({
      ...AC1,
      lines: [line("rent", "1000", "1000", true), line("cafe", "2000", "2150")],
      outsidePlan: zero,
      obligations: { recurring: [], debtMinimums: [] },
      goalContributions: zero,
    });
    expect(s.overspend).toEqual({ amount: eur("150"), base: eur("2000") });
    expect(s.daily.isZero()).toBe(true);
  });

  it("BUD-03@PoC FR 10: without limits the budget is the expected income less the planned savings; spending «Поза планом» counts", () => {
    const s = spendable({
      ...AC1,
      outsidePlan: eur("5600"),
      obligations: { recurring: [], debtMinimums: [] },
      goalContributions: zero,
      plannedSavings: eur("500"),
    });
    expect(s.overspend).toEqual({ amount: eur("100"), base: zero });
    expect(s.daily.isZero()).toBe(true);
    // Exactly the budget is no overspend.
    expect(spendable({ ...AC1, outsidePlan: eur("5500"), plannedSavings: eur("500") }).overspend).toBeNull();
  });
});

describe("BUD-03@PoC: regular payments and loans", () => {
  const loans: PeriodObligations = {
    recurring: [unpaid("100"), { categoryId: null, amount: eur("900"), paid: true }],
    debtMinimums: [
      { accountId: "loan-a", amount: eur("250"), paid: false },
      { accountId: "loan-b", amount: eur("400"), paid: true },
    ],
  };

  it("BUD-03@PoC FR 5: only unpaid charges count, and a loan's monthly payment once while the month has no payment to it", () => {
    const s = spendable({ ...AC1, obligations: loans });
    expect(s.regularPayments).toEqual(eur("350"));
    expect(s.amount).toEqual(eur("2850"));
  });

  it("BUD-03@PoC FR 2: an amount in another currency is never added — the source converts it first (EC4)", () => {
    expect(() => spendable({ ...AC1, goalContributions: Money.of("1", "USD") })).toThrow(
      CurrencyMismatchError,
    );
    expect(() =>
      spendable({
        ...AC1,
        obligations: {
          recurring: [],
          debtMinimums: [{ accountId: "x", amount: Money.of("1", "USD"), paid: false }],
        },
      }),
    ).toThrow(CurrencyMismatchError);
  });
});

describe("BUD-03@PoC: the mini breakdown", () => {
  it("BUD-03@PoC FR 15: five rows with amounts — «Дохід», «Витрачено», «Регулярні платежі», «Цілі», «Обов'язкові»; income less the other four is the sum", () => {
    const s = spendable({
      ...AC1,
      lines: [line("groceries", "620", "590", true)],
      outsidePlan: eur("1710"),
      plannedExpenses: eur("100"),
    });
    expect(s.mini.map((r) => [r.row, r.amount.toDecimalString()])).toEqual([
      ["income", "6000"],
      ["spent", "2300"],
      ["regular", "1900"],
      ["goals", "600"],
      ["mandatory", "30"],
    ]);
    const [income, ...rest] = s.mini;
    expect(rest.reduce((t, r) => t.minus(r.amount), income!.amount)).toEqual(s.amount);
  });

  it("BUD-03@PoC FR 3: the breakdown keeps income as plan, actual and expected; goal contributions apart from planned expenses (FR 6)", () => {
    const s = spendable({
      ...AC1,
      incomeActual: eur("5000"),
      incomeExpected: eur("300"),
      plannedExpenses: eur("100"),
    });
    expect(s.income).toEqual({
      plan: eur("6000"),
      actual: eur("5000"),
      expected: eur("5300"),
      value: eur("6000"),
      pending: true,
    });
    expect(s.goalContributions).toEqual(eur("500"));
    expect(s.plannedExpenses).toEqual(eur("100"));
  });
});
