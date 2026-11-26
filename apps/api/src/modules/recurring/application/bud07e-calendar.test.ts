import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { buildCalendar, type CalendarDeps, type LoanAccount } from "./index.ts";

const eur = (amount: string) => Money.of(amount, "EUR");
const TODAY = "2026-11-18";
const empty = { byPayment: new Map(), used: new Map(), history: new Map() };

function deps(loans: readonly LoanAccount[], debts: string[] = []): CalendarDeps & { debts: string[] } {
  return {
    debts,
    loans: {
      list: async () => loans,
      inflows: async () => [{ accountId: "loan-1", transactionId: "t-oct", date: "2026-10-14" }],
      async debt(_householdId, ledgerAccountId, date) {
        debts.push(`${ledgerAccountId}@${date}`);
        return eur("8750");
      },
    },
    report: async (amounts) => ({ values: amounts, approximate: false }),
    today: () => TODAY,
  };
}

const range = { from: "2026-11-01", to: "2026-11-30" };

describe("BUD-07@PoC FR 16: «Кредит» accounts in the calendar (application)", () => {
  it("BUD-07@PoC FR 16: a loan without a monthly payment («Додайте ставку і платіж») has no planned payment but is listed", async () => {
    const loans: LoanAccount[] = [
      {
        accountId: "loan-0",
        name: "Без умов",
        monthlyPayment: null,
        annualRate: null,
        ledgerAccountId: null,
        openedOn: null,
      },
    ];
    const c = await buildCalendar(deps(loans), "h", [], empty, range, "EUR");
    expect(c.items).toEqual([]);
    expect(c.loans).toEqual(loans);
    expect(c.totals.loans?.toDecimalString()).toBe("0");
    expect(c.period.charges).toBe(0);
  });

  it("BUD-07@PoC FR 16: without a rate the payment has no interest; with one, today's debt while the month is unpaid", async () => {
    const base = {
      accountId: "loan-1",
      name: "Кредит",
      monthlyPayment: eur("250"),
      ledgerAccountId: "ledger-1",
      openedOn: null,
    };
    let c = await buildCalendar(deps([{ ...base, annualRate: null }]), "h", [], empty, range, "EUR");
    expect(c.items.map((i) => [i.kind, i.dueOn, i.status, i.interest])).toEqual([
      ["loan", "2026-11-14", "overdue", null],
    ]);
    const d = deps([{ ...base, annualRate: "12" }]);
    c = await buildCalendar(d, "h", [], empty, range, "EUR");
    expect(c.items[0]!.interest?.toDecimalString()).toBe("87.5");
    expect(d.debts).toEqual([`ledger-1@${TODAY}`]);
    expect(c.period).toMatchObject({ charges: 1, paid: 0, overdue: 1 });
    expect(c.period.remaining?.toDecimalString()).toBe("250");
  });

  it("BUD-07@PoC FR 16: a loan payment without a rate to the reporting currency leaves the totals without a figure", async () => {
    const loans: LoanAccount[] = [
      {
        accountId: "loan-1",
        name: "Кредит",
        monthlyPayment: eur("250"),
        annualRate: null,
        ledgerAccountId: null,
        openedOn: null,
      },
    ];
    const d = deps(loans);
    const c = await buildCalendar(
      { ...d, report: async (amounts) => ({ values: amounts.map(() => null), approximate: false }) },
      "h",
      [],
      empty,
      range,
      "EUR",
    );
    expect([c.totals.expenses, c.totals.loans, c.totals.yearExpenses, c.period.remaining]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    // A figure without any amount is a zero, not «no figure».
    expect(c.totals.incomes?.toDecimalString()).toBe("0");
  });
});

describe("BUD-07@PoC FR 16, FR 7: the start of the read and «За рік» (review round 1)", () => {
  it("BUD-07@PoC FR 16: from the oldest day allowed, the payments of that whole month are read, so an earlier one still pays its month", async () => {
    const asked: string[] = [];
    const inflows = [
      { accountId: "loan-1", transactionId: "t-sep", date: "2025-09-05" },
      { accountId: "loan-1", transactionId: "t-oct", date: "2025-10-20" },
    ];
    const d: CalendarDeps = {
      ...deps([]),
      loans: {
        list: async () => [
          {
            accountId: "loan-1",
            name: "Кредит",
            monthlyPayment: eur("250"),
            annualRate: null,
            ledgerAccountId: null,
            openedOn: "2025-01-01",
          },
        ],
        async inflows(_h, _ids, from, to) {
          asked.push(`${from}..${to}`);
          return inflows.filter((i) => i.date >= from && i.date <= to);
        },
        debt: async () => eur("0"),
      },
    };
    const c = await buildCalendar(d, "h", [], empty, { from: "2025-09-15", to: "2025-09-30" }, "EUR");
    expect(asked).toEqual([`2025-09-01..${TODAY}`]);
    // The day is the 20th (the latest payment); September's first payment, on the 5th, pays it.
    expect(c.items.map((i) => [i.dueOn, i.status, i.transactionId])).toEqual([
      ["2025-09-20", "paid", "t-sep"],
    ]);
  });

  it("BUD-07@PoC FR 7: «За рік» of a payment ending within the year counts only its charges up to the end date", async () => {
    const p = {
      id: "p",
      name: "Синтетичний курс",
      expected: eur("40"),
      frequency: "month" as const,
      anchorDate: "2026-11-25",
      categoryId: null,
      accountId: null,
      endDate: "2027-02-10",
      type: "expense" as const,
      subscription: false,
      variable: false,
      merchantId: null,
      source: "manual" as const,
      createdOn: "2026-11-01",
      version: 1,
      current: null,
      keptOn: null,
    };
    const t = {
      charges: [],
      expected: eur("40"),
      amountChange: null,
      changes: [],
      missesInRow: 0,
      state: "active" as const,
      approximate: false,
      used: [],
      holds: [],
      hold: null,
    };
    const space = { byPayment: new Map([["p", t]]), used: new Map(), history: new Map() };
    const c = await buildCalendar(deps([]), "h", [p], space, range, "EUR");
    // 25 November, 25 December, 25 January — not 12 × 40.
    expect(c.totals.yearExpenses?.toDecimalString()).toBe("120");
  });
});
