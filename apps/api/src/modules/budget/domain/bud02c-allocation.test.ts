import { describe, expect, it } from "vitest";
import { CurrencyMismatchError, Money } from "@willowsum/domain-kernel";
import {
  allocationBalance,
  allocationChoice,
  categoriesSummary,
  expectedPayments,
  type LimitLine,
  type PeriodObligations,
} from "./index.ts";

/** BUD-02@PoC c) (wave 2 row 31): «Розподіл», the totals row of «Категорії» and the plan of a future month. */
const eur = (amount: string) => Money.of(amount, "EUR");
const NONE: PeriodObligations = { recurring: [], debtMinimums: [] };
const limit = (categoryId: string, amount: string) => ({ categoryId, amount: eur(amount) });

const line = (categoryId: string, l: string, spent: string, mandatory = false): LimitLine => ({
  categoryId,
  groupId: "g",
  mandatory,
  limit: eur(l),
  spent: eur(spent),
  remaining: eur(l).minus(eur(spent)),
});

describe("BUD-02@PoC: «Розподіл» — surplus and deficit", () => {
  it("BUD-02@PoC AC6: income 5 600 €, limits 2 860 €, no regular payments outside limits — «не розподілено 2 740 €», a surplus", () => {
    const b = allocationBalance({
      incomePlan: eur("5600"),
      limits: [limit("groceries", "2000"), limit("cafes", "860")],
      obligations: NONE,
    });
    expect(b.limits).toEqual(eur("2860"));
    expect(b.recurringOutsideLimits).toEqual(eur("0"));
    expect(b.unallocated).toEqual(eur("2740"));
    expect(b).toMatchObject({ kind: "surplus" });
    expect(b.amount).toEqual(eur("2740"));
  });

  it("BUD-02@PoC FR 15: the difference takes regular payments outside limits and the debts' minimum payments; a payment in a limited category is in its limit", () => {
    const b = allocationBalance({
      incomePlan: eur("3000.00"),
      limits: [limit("groceries", "1200.50")],
      obligations: {
        recurring: [
          { categoryId: "rent", amount: eur("900"), paid: true },
          { categoryId: null, amount: eur("15.99"), paid: false },
          // In «groceries», which has a limit: not counted again.
          { categoryId: "groceries", amount: eur("40"), paid: false },
        ],
        debtMinimums: [{ accountId: "card", amount: eur("120.01") }],
      },
    });
    expect(b.recurringOutsideLimits).toEqual(eur("915.99"));
    // FR 3: the bar — 3000 − 1200.50 − 915.99.
    expect(b.unallocated).toEqual(eur("883.51"));
    expect(b.debtMinimums).toEqual(eur("120.01"));
    expect(b.difference).toEqual(eur("763.5"));
    expect(b.kind).toBe("surplus");
  });

  it("BUD-02@PoC AC7: income 3 000 €, limits 3 200 € — a deficit «Звідки візьмуться 200 €?»", () => {
    const b = allocationBalance({ incomePlan: eur("3000"), limits: [limit("a", "3200")], obligations: NONE });
    expect(b.difference).toEqual(eur("-200"));
    expect(b.kind).toBe("deficit");
    expect(b.amount).toEqual(eur("200"));
  });

  it("BUD-02@PoC FR 15 boundary: zero — nothing to allocate; an empty plan is balanced too", () => {
    const b = allocationBalance({
      incomePlan: eur("100.10"),
      limits: [limit("a", "100.1")],
      obligations: NONE,
    });
    expect(b.kind).toBe("balanced");
    expect(b.amount.isZero()).toBe(true);
    expect(allocationBalance({ incomePlan: eur("0"), limits: [], obligations: NONE }).kind).toBe("balanced");
  });

  it("BUD-02@PoC AC7: «Створити бюджет» stays inactive while the chosen options cover less than 200 €; exactly 200 € covers it", () => {
    const b = allocationBalance({ incomePlan: eur("3000"), limits: [limit("a", "3200")], obligations: NONE });
    expect(allocationChoice(b, [])).toMatchObject({ status: "short" });
    const short = allocationChoice(b, [eur("120"), eur("79.99")]);
    expect(short.status).toBe("short");
    expect(short.rest).toEqual(eur("0.01"));
    const exact = allocationChoice(b, [eur("120"), eur("50"), eur("30.00")]);
    expect(exact.status).toBe("exact");
    expect(exact.chosen).toEqual(eur("200"));
    expect(allocationChoice(b, [eur("200.01")]).status).toBe("over");
  });

  it("BUD-02@PoC FR 15: a surplus may be left unallocated — the rest is «Не розподілено N €»", () => {
    const b = allocationBalance({ incomePlan: eur("5600"), limits: [limit("a", "2860")], obligations: NONE });
    const c = allocationChoice(b, [eur("334"), eur("500")]);
    expect(c.status).toBe("short");
    expect(c.rest).toEqual(eur("1906"));
  });

  it("BUD-02@PoC FR 1: one currency — a limit, a payment or a chosen amount in another currency is refused", () => {
    expect(() =>
      allocationBalance({
        incomePlan: eur("10"),
        limits: [{ categoryId: "a", amount: Money.of("5", "UAH") }],
        obligations: NONE,
      }),
    ).toThrow(CurrencyMismatchError);
    expect(() =>
      allocationBalance({
        incomePlan: eur("10"),
        limits: [],
        obligations: { recurring: [], debtMinimums: [{ accountId: "x", amount: Money.of("1", "USD") }] },
      }),
    ).toThrow(CurrencyMismatchError);
    const b = allocationBalance({ incomePlan: eur("10"), limits: [], obligations: NONE });
    expect(() => allocationChoice(b, [Money.of("1", "UAH")])).toThrow(CurrencyMismatchError);
  });
});

describe("BUD-02@PoC: the totals row of «Категорії»", () => {
  // AC9: limits 3 143 €, spent 2 806.77 €, 4 categories over by 76.17 €, the mandatory ones still need 497.10 €.
  const ac9 = [
    line("rent", "1200", "1200", true), // 0 left
    line("utilities", "300", "120.40", true), // 179.60 left
    line("groceries", "700", "682.50", true), // 17.50 left → the limits part of D: 197.10
    line("cafes", "200", "230.05"), // −30.05
    line("clothes", "150", "170"), // −20
    line("fun", "100", "120.12"), // −20.12
    line("taxi", "60", "66"), // −6 → 76.17 in 4 categories
    line("books", "433", "217.70"),
  ];
  const recurring: PeriodObligations = {
    recurring: [
      { categoryId: "insurance", amount: eur("250"), paid: false },
      { categoryId: null, amount: eur("50.00"), paid: false },
      // Paid: not needed any more.
      { categoryId: "gym", amount: eur("30"), paid: true },
      // In a mandatory category with a limit: already in its rest — not counted twice.
      { categoryId: "rent", amount: eur("1200"), paid: false },
    ],
    debtMinimums: [],
  };

  it("BUD-02@PoC AC9: «Витрачено 2 806,77 € з 3 143,00 €», «Перевитрата 76,17 € у 4 категоріях», «Ще потрібно на обов'язкові 497,10 €», «Вільний залишок −160,87 €»", () => {
    const s = categoriesSummary(ac9, "EUR", recurring);
    expect(s.spent).toEqual(eur("2806.77"));
    expect(s.limits).toEqual(eur("3143"));
    expect(s.overspend.amount).toEqual(eur("76.17"));
    expect(s.overspend.count).toBe(4);
    expect(s.mandatoryRemaining).toEqual(eur("197.10"));
    expect(s.unpaidRecurring).toEqual(eur("300"));
    expect(s.mandatoryNeeded).toEqual(eur("497.10"));
    expect(s.free).toEqual(eur("-160.87"));
    expect(s.free!.toDecimalString()).toBe("-160.87");
    expect(s.optionalLimits).toEqual(eur("943"));
  });

  it("BUD-02@PoC FR 19: an overspent mandatory category adds 0 to D, not its negative rest; only negative remainders make the overspend", () => {
    const s = categoriesSummary([line("rent", "100", "130", true), line("cafes", "50", "10")], "EUR", {
      recurring: [],
      debtMinimums: [],
    });
    expect(s.mandatoryRemaining).toEqual(eur("0"));
    expect(s.overspend.amount).toEqual(eur("30"));
    expect(s.overspend.count).toBe(1);
    // E = 150 − 140 − 0.
    expect(s.free).toEqual(eur("10"));
  });

  it("BUD-02@PoC FR 19 boundary: zero — no limits gives 0 everywhere and no «−0»", () => {
    const s = categoriesSummary([], "EUR", { recurring: [], debtMinimums: [] });
    expect(s.overspend.amount.toDecimalString()).toBe("0");
    expect(s.overspend.count).toBe(0);
    expect(s.free!.toDecimalString()).toBe("0");
    expect(s.spent.isZero() && s.limits.isZero()).toBe(true);
  });

  it("BUD-02@PoC FR 19: without the regular payments known, D and E are null and the other numbers stay exact", () => {
    const s = categoriesSummary(ac9, "EUR", null);
    expect(s.unpaidRecurring).toBeNull();
    expect(s.mandatoryNeeded).toBeNull();
    expect(s.free).toBeNull();
    expect(s.overspend.amount).toEqual(eur("76.17"));
    expect(s.mandatoryRemaining).toEqual(eur("197.10"));
  });

  it("BUD-02@PoC FR 1: a line or a payment in another currency is refused, never added", () => {
    expect(() =>
      categoriesSummary([line("a", "10", "1")], "UAH", { recurring: [], debtMinimums: [] }),
    ).toThrow(CurrencyMismatchError);
    expect(() =>
      categoriesSummary([], "EUR", {
        recurring: [{ categoryId: null, amount: Money.of("1", "UAH"), paid: false }],
        debtMinimums: [],
      }),
    ).toThrow(CurrencyMismatchError);
  });
});

describe("BUD-02@PoC: the plan of a future month", () => {
  it("BUD-02@PoC AC8: «Очікувані платежі» — the month's regular payments by category and their total", () => {
    const e = expectedPayments(
      {
        recurring: [
          { categoryId: "rent", amount: eur("900"), paid: false },
          { categoryId: "subs", amount: eur("9.99"), paid: false },
          { categoryId: "subs", amount: eur("5.01"), paid: false },
          { categoryId: null, amount: eur("1"), paid: false },
        ],
        debtMinimums: [],
      },
      "EUR",
    );
    expect(e.categories).toEqual([
      { categoryId: "rent", amount: eur("900") },
      { categoryId: "subs", amount: eur("15") },
      { categoryId: null, amount: eur("1") },
    ]);
    expect(e.total).toEqual(eur("916"));
  });
});
