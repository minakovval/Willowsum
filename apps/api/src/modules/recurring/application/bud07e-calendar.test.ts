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
