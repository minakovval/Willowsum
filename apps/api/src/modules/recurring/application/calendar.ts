import { Money } from "@willowsum/domain-kernel";
import {
  addDays,
  chargesBetween,
  CHARGES_A_YEAR,
  loanCharges,
  monthlyInterest,
  scheduleBetween,
  type ChargeStatus,
  type LoanInflow,
  type PaymentType,
} from "../domain/index.ts";
import type { StoredPayment } from "./payments.ts";
import { HISTORY_DAYS } from "./proposals.ts";
import type { SpaceTracking } from "./tracking.ts";

/**
 * The calendar of «Регулярні платежі» (BUD-07@PoC FR 7, FR 16, FR 19; wave 2 row 26, the rest of part b2): the charges of
 * the space's payments and the monthly payments of its «Кредит» accounts from a date over 1–366 days, the month's and the
 * year's totals in the reporting currency, and the current period as the budget card «Регулярні платежі» heads it. Read
 * only: a projection of the schedules and the transactions as they are now (FR 17).
 */

/** FR 16: a «Кредит» account as the calendar reads it (modules accounts and liabilities). */
export interface LoanAccount {
  readonly accountId: string;
  readonly name: string;
  /** Null — «Додайте ставку і платіж»: no planned payment. */
  readonly monthlyPayment: Money | null;
  /** Per cent a year; null — none. */
  readonly annualRate: string | null;
  /** The journal account of the wallet in the payment's currency (module ledger); null — none. */
  readonly ledgerAccountId: string | null;
  /** The account's opening date — the earliest balance date of its wallets; null — not known. */
  readonly openedOn: string | null;
}

export interface CalendarDeps {
  readonly loans: {
    /** The space's active «Кредит» accounts, in the order they were added. */
    list(householdId: string): Promise<readonly LoanAccount[]>;
    /** The payments to these accounts (inflows, module transactions) dated `from`–`to`. */
    inflows(
      householdId: string,
      accountIds: readonly string[],
      from: string,
      to: string,
    ): Promise<readonly (LoanInflow & { readonly accountId: string })[]>;
    /** What is owed on the journal account at the end of `date` (positive — owed; module ledger). */
    debt(householdId: string, ledgerAccountId: string, date: string): Promise<Money>;
  };
  /**
   * FR 7: amounts at today's rate in the reporting currency (module fx-rates), in the order given; null — no rate at
   * all; `approximate` — the nearest earlier rate.
   */
  readonly report: (
    amounts: readonly Money[],
    currency: string,
  ) => Promise<{ readonly values: readonly (Money | null)[]; readonly approximate: boolean }>;
  readonly today: () => string;
}

export interface CalendarCharge {
  /** `payment` — a regular payment's charge; `loan` — FR 16, the monthly payment of a «Кредит» account. */
  readonly kind: "payment" | "loan";
  readonly paymentId: string | null;
  /** The payment's account («рахунок списання»), or the loan's own account. */
  readonly accountId: string | null;
  readonly name: string;
  readonly type: PaymentType;
  readonly subscription: boolean;
  readonly variable: boolean;
  readonly dueOn: string;
  readonly expected: Money;
  readonly status: ChargeStatus;
  readonly overdueDays: number | null;
  readonly transactionId: string | null;
  readonly paidOn: string | null;
  /** FR 10: false for a payment «Можливо, скасований» — shown, but in no total and not in «Можна витратити». */
  readonly counted: boolean;
  /** FR 16: the interest of a loan's month — its only spending; null — not known (no rate, a later month). */
  readonly interest: Money | null;
}

export interface CalendarTotals {
  /** The current month (YYYY-MM): its charges as the totals count them. */
  readonly month: string;
  /** Null for a figure one of whose amounts has no rate at all. */
  readonly expenses: Money | null;
  readonly subscriptions: Money | null;
  readonly loans: Money | null;
  readonly incomes: Money | null;
  /** «За рік»: a year of each counted payment (52 weeks, 26, 12, 4, 1) and twelve of each loan's payment. */
  readonly yearExpenses: Money | null;
  readonly yearIncomes: Money | null;
  /** «приблизно»: an amount at the nearest earlier rate — gone once today's rate is there. */
  readonly approximate: boolean;
}

/** FR 19: «сплачено N з M · K прострочено · лишилось X €» — the current month's expense charges. */
export interface CalendarPeriod {
  readonly month: string;
  readonly charges: number;
  readonly paid: number;
  readonly overdue: number;
  /** «лишилось»: the charges still «Очікується» or «Прострочено», at today's rate; null — one without a rate. */
  readonly remaining: Money | null;
  readonly approximate: boolean;
}

export interface Calendar {
  readonly items: readonly CalendarCharge[];
  /** FR 16: every active «Кредит» account; one without a monthly payment has no charge («Додайте ставку і платіж»). */
  readonly loans: readonly LoanAccount[];
  readonly totals: CalendarTotals;
  readonly period: CalendarPeriod;
}

const lastDay = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

const byDate = (a: CalendarCharge, b: CalendarCharge) =>
  a.dueOn.localeCompare(b.dueOn) ||
  a.name.localeCompare(b.name) ||
  (a.paymentId ?? a.accountId ?? "").localeCompare(b.paymentId ?? b.accountId ?? "");

/** The charges of the payments from `from` to `to`; a payment «Можливо, скасований» shown, not counted. */
function paymentCharges(
  payments: readonly StoredPayment[],
  tracking: SpaceTracking,
  from: string,
  to: string,
  today: string,
): CalendarCharge[] {
  return payments.flatMap((p) => {
    const t = tracking.byPayment.get(p.id);
    if (!t) return [];
    const counted = new Set(chargesBetween(p, t, from, to, today).map((c) => c.dueOn));
    return chargesBetween(p, t, from, to, today, { flagged: "shown" }).map((c): CalendarCharge => ({
      kind: "payment",
      paymentId: p.id,
      accountId: p.accountId,
      name: p.name,
      type: p.type,
      subscription: p.subscription,
      variable: p.variable,
      dueOn: c.dueOn,
      expected: c.expected,
      status: c.status,
      overdueDays: c.overdueDays,
      transactionId: c.transactionId,
      paidOn: c.paidOn,
      counted: counted.has(c.dueOn),
      interest: null,
    }));
  });
}

async function loanItems(
  deps: CalendarDeps,
  householdId: string,
  loans: readonly LoanAccount[],
  inflows: readonly (LoanInflow & { readonly accountId: string })[],
  from: string,
  to: string,
  today: string,
): Promise<CalendarCharge[]> {
  const out: CalendarCharge[] = [];
  for (const loan of loans) {
    if (loan.monthlyPayment === null) continue;
    const own = inflows.filter((i) => i.accountId === loan.accountId);
    for (const c of loanCharges(loan.accountId, loan.monthlyPayment, own, from, to, today, loan.openedOn)) {
      // The interest of a month up to this one: the debt before its first payment, or today's while unpaid.
      let interest: Money | null = null;
      if (
        loan.annualRate !== null &&
        loan.ledgerAccountId !== null &&
        c.dueOn.slice(0, 7) <= today.slice(0, 7)
      ) {
        const debt = await deps.loans.debt(
          householdId,
          loan.ledgerAccountId,
          c.paidOn === null ? today : addDays(c.paidOn, -1),
        );
        interest = monthlyInterest(debt, loan.annualRate);
      }
      out.push({
        kind: "loan",
        paymentId: null,
        accountId: loan.accountId,
        name: loan.name,
        type: "expense",
        subscription: false,
        variable: false,
        dueOn: c.dueOn,
        expected: c.expected,
        status: c.status,
        overdueDays: c.overdueDays,
        transactionId: c.transactionId,
        paidOn: c.paidOn,
        counted: true,
        interest,
      });
    }
  }
  return out;
}

/** Sums of amounts converted at once; a figure with an amount without a rate is null. */
async function sums(
  deps: CalendarDeps,
  currency: string,
  groups: readonly (readonly Money[])[],
): Promise<{ values: (Money | null)[]; approximate: boolean }> {
  const flat = groups.flat();
  if (flat.length === 0) return { values: groups.map(() => null), approximate: false };
  const { values, approximate } = await deps.report(flat, currency);
  let i = 0;
  const out = groups.map((g) => {
    let total: Money | null = null;
    let missing = false;
    for (let k = 0; k < g.length; k++) {
      const v = values[i++] ?? null;
      if (v === null) missing = true;
      else total = total === null ? v : total.plus(v);
    }
    return missing ? null : total;
  });
  return { values: out, approximate };
}

export async function buildCalendar(
  deps: CalendarDeps,
  householdId: string,
  payments: readonly StoredPayment[],
  tracking: SpaceTracking,
  range: { readonly from: string; readonly to: string },
  currency: string,
): Promise<Calendar> {
  const today = deps.today();
  const month = today.slice(0, 7);
  const monthFrom = `${month}-01`;
  const monthTo = lastDay(month);

  const loans = await deps.loans.list(householdId);
  const planned = loans.filter((l) => l.monthlyPayment !== null);
  // From the 1st of the month of the earliest day read: a payment earlier in that month pays it (FR 16).
  const earliest = [range.from, monthFrom, addDays(today, -(HISTORY_DAYS - 1))].sort()[0]!;
  const earliestMonthStart = `${earliest.slice(0, 7)}-01`;
  const inflows =
    planned.length === 0
      ? []
      : await deps.loans.inflows(
          householdId,
          planned.map((l) => l.accountId),
          earliestMonthStart,
          today,
        );

  const items = [
    ...paymentCharges(payments, tracking, range.from, range.to, today),
    ...(await loanItems(deps, householdId, loans, inflows, range.from, range.to, today)),
  ].sort(byDate);

  // The current month, whatever the range: the totals and the budget card's header.
  const monthCharges = paymentCharges(payments, tracking, monthFrom, monthTo, today);
  const monthLoans = planned.flatMap((l) =>
    loanCharges(
      l.accountId,
      l.monthlyPayment!,
      inflows.filter((i) => i.accountId === l.accountId),
      monthFrom,
      monthTo,
      today,
      l.openedOn,
    ),
  );
  const counted = monthCharges.filter((c) => c.counted && c.status !== "skipped");
  const expenses = counted.filter((c) => c.type === "expense");
  const incomes = counted.filter((c) => c.type === "income");

  // «За рік»: the payments counted today — active, not held, not ended.
  const yearly = payments.filter((p) => {
    const t = tracking.byPayment.get(p.id);
    return t && t.state === "active" && t.hold === null && (p.endDate === null || p.endDate >= today);
  });
  // A payment that ends within the year counts only its charges from today to its end date.
  const yearEnd = addDays(today, 364);
  const perYear = (p: StoredPayment) => {
    const t = tracking.byPayment.get(p.id)!;
    const count =
      p.endDate !== null && p.endDate < yearEnd
        ? scheduleBetween(p.anchorDate, p.frequency, today, p.endDate).length
        : CHARGES_A_YEAR[p.frequency];
    return Money.of(t.expected.amount.times(count), t.expected.currency);
  };

  const periodCharges = [...monthCharges.filter((c) => c.counted && c.type === "expense"), ...monthLoans];
  const owed = periodCharges.filter((c) => c.status === "expected" || c.status === "overdue");

  const { values, approximate } = await sums(deps, currency, [
    [...expenses.map((c) => c.expected), ...monthLoans.map((c) => c.expected)],
    expenses.filter((c) => c.subscription).map((c) => c.expected),
    monthLoans.map((c) => c.expected),
    incomes.map((c) => c.expected),
    [
      ...yearly.filter((p) => p.type === "expense").map(perYear),
      ...planned.map((l) => Money.of(l.monthlyPayment!.amount.times(12), l.monthlyPayment!.currency)),
    ],
    yearly.filter((p) => p.type === "income").map(perYear),
  ]);
  const remaining = await sums(deps, currency, [owed.map((c) => c.expected)]);
  const zeroOr = (v: Money | null, parts: number) => (parts === 0 ? Money.zero(currency) : v);

  return {
    items,
    loans,
    totals: {
      month,
      expenses: zeroOr(values[0]!, expenses.length + monthLoans.length),
      subscriptions: zeroOr(values[1]!, expenses.filter((c) => c.subscription).length),
      loans: zeroOr(values[2]!, monthLoans.length),
      incomes: zeroOr(values[3]!, incomes.length),
      yearExpenses: zeroOr(values[4]!, yearly.filter((p) => p.type === "expense").length + planned.length),
      yearIncomes: zeroOr(values[5]!, yearly.filter((p) => p.type === "income").length),
      approximate,
    },
    period: {
      month,
      charges: periodCharges.length,
      paid: periodCharges.filter((c) => c.status === "paid" || c.status === "paid-late").length,
      overdue: periodCharges.filter((c) => c.status === "overdue").length,
      remaining: zeroOr(remaining.values[0]!, owed.length),
      approximate: remaining.approximate,
    },
  };
}
