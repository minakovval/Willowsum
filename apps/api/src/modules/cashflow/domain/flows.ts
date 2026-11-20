import { currencyInfo, Decimal, Money } from "@willowsum/domain-kernel";
import type { Month, MonthFigures, PeriodTotals } from "./cashflow.ts";

/**
 * Pure rules of where the net flow went (BUD-08@PoC; server part b): contributions to goals (FR 5) and investments with
 * withdrawals (FR 6), the split of a loan payment into interest and «Погашення боргу» (FR 7), «Залишилось на рахунках»
 * (FR 4) and the layer «з цілей» of the spending (FR 10). No I/O.
 */

/** FR 5, FR 6: a marked transfer between own accounts, by its accounts and the outflow's date. */
export interface TransferAccounts {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly date: string;
}

/** FR 5: an own account of a goal and the days it was the goal's (`closedOn` null — still open). */
export interface GoalAccountSpan {
  readonly goalId: string;
  readonly accountId: string;
  readonly createdOn: string;
  readonly closedOn: string | null;
}

export type TransferFlow =
  | { readonly kind: "goal"; readonly goalId: string }
  | { readonly kind: "investment" }
  | { readonly kind: "withdrawal" };

/**
 * FR 5, FR 6, AC4: a transfer out of a budget account into a brokerage account is a contribution to investments, one
 * back is a withdrawal (shown apart, not taken off the contributions), one between brokerage accounts is neither; a
 * transfer out of a budget account into the own account of a goal, on a day the account was the goal's, is a
 * contribution to that goal. Any other transfer between own accounts (to a savings account without a goal) is none.
 */
export function transferFlow(
  t: TransferAccounts,
  budget: ReadonlySet<string>,
  investment: ReadonlySet<string>,
  goals: readonly GoalAccountSpan[],
): TransferFlow | null {
  const fromBudget = budget.has(t.fromAccountId);
  if (investment.has(t.fromAccountId))
    return investment.has(t.toAccountId) || !budget.has(t.toAccountId) ? null : { kind: "withdrawal" };
  if (!fromBudget) return null;
  if (investment.has(t.toAccountId)) return { kind: "investment" };
  const goal = goals.find(
    (g) =>
      g.accountId === t.toAccountId && g.createdOn <= t.date && (g.closedOn === null || t.date <= g.closedOn),
  );
  return goal ? { kind: "goal", goalId: goal.goalId } : null;
}

/** FR 7: a payment to a loan — an inflow on its account, in the loan's currency — on its date. */
export interface LoanPayment {
  readonly date: string;
  readonly amount: Money;
}

export interface LoanPaymentSplit {
  readonly date: string;
  /** The interest of the month: spending in «Відсотки за кредитами». Zero for every payment but the first. */
  readonly interest: Money;
  /** What lowers the debt — «Погашення боргу»; negative when the payment is less than the interest (the debt grows). */
  readonly principal: Money;
}

/**
 * FR 7, AC7, edge case 2: the payments of one loan in one calendar month, oldest first. For the first payment the
 * interest = the debt before it × the annual rate ÷ 12, rounded to the cent half to even (owner decision 2026-11-16); the
 * rest of it lowers the debt. A payment less than the interest still leaves the whole interest as spending, the unpaid
 * part added to the debt (a negative principal). The other payments lower the debt in full. Without a rate, or in a
 * month with the bank's own interest operation, no payment is split: each lowers the debt in full.
 */
export function splitLoanMonth(input: {
  readonly payments: readonly LoanPayment[];
  /** Per cent a year, e.g. "4.2"; null — no rate. */
  readonly annualRate: string | null;
  /** The debt before the first payment (positive — owed); null when not needed. */
  readonly debtBefore: Money | null;
  readonly bankInterest: boolean;
}): LoanPaymentSplit[] {
  const { payments, annualRate, debtBefore, bankInterest } = input;
  return payments.map((p, i) => {
    const zero = Money.zero(p.amount.currency);
    if (i > 0 || bankInterest || annualRate === null || debtBefore === null)
      return { date: p.date, interest: zero, principal: p.amount };
    const owed = debtBefore.isNegative() ? new Decimal("0") : debtBefore.amount;
    const interest = Money.of(
      owed
        .times(new Decimal(annualRate))
        .div(new Decimal("1200"))
        .toDecimalPlaces(currencyInfo(p.amount.currency).minorUnits, Decimal.ROUND_HALF_EVEN),
      p.amount.currency,
    );
    return { date: p.date, interest, principal: p.amount.minus(interest) };
  });
}

/** FR 7: an operation of a loan's account in the loan's currency, chronological. */
export interface LoanOperation {
  readonly id: string;
  readonly date: string;
  readonly amount: Money;
  /** An inflow that is the loan's payment (not a side of a pair awaiting confirmation). */
  readonly payment: boolean;
  /** The bank's own interest operation (imported, in «Відсотки за кредитами»). */
  readonly bankInterest: boolean;
}

/** FR 7: one calendar month of one loan, as calculated. */
export interface LoanMonth {
  readonly month: Month;
  readonly splits: readonly LoanPaymentSplit[];
  /** The month's bank interest operations: its interest spending instead of the calculation. */
  readonly bankInterest: readonly LoanOperation[];
  /** Edge case 2: the month's payments were not split for want of a rate. */
  readonly withoutRate: boolean;
}

/** FR 7: what the calculation needs to read — the first payment's date of each month that is calculated. */
export function loanDebtDates(
  operations: readonly LoanOperation[],
  rateOn: (date: string) => string | null,
): string[] {
  return groupByMonth(operations)
    .map(([, ops]) => ops)
    .filter((ops) => !ops.some((o) => o.bankInterest))
    .map((ops) => ops.find((o) => o.payment)?.date ?? null)
    .filter((d): d is string => d !== null && rateOn(d) !== null);
}

function groupByMonth(operations: readonly LoanOperation[]): [Month, LoanOperation[]][] {
  const months = new Map<Month, LoanOperation[]>();
  for (const o of operations) months.set(o.date.slice(0, 7), [...(months.get(o.date.slice(0, 7)) ?? []), o]);
  return [...months].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * FR 7, AC7: the loan's months from its opening on, oldest first. The journal lowers the debt by the whole payment and
 * never holds the calculated interest, so the debt before a month's first payment is the journal's debt then plus the
 * interest calculated for the earlier months — the unpaid interest «додано до боргу» and the paid one taken back out of
 * the payment. A month with the bank's own interest operation is not calculated: that operation is in the journal, and
 * the interest calculated for the earlier months stays carried (the journal still lacks it). «Оновити залишок»
 * (`adjustedOn`, the date of the wallet's adjustment in effect) puts the real debt in the journal: interest calculated
 * for payments on or before that date is no longer added after it. `journalBefore` — the journal's debt at the end of
 * the day before each date of `loanDebtDates`.
 */
export function loanMonths(
  operations: readonly LoanOperation[],
  rateOn: (date: string) => string | null,
  journalBefore: ReadonlyMap<string, Money>,
  adjustedOn: string | null = null,
): LoanMonth[] {
  const accrued: { readonly date: string; readonly interest: Money }[] = [];
  return groupByMonth(operations).map(([month, ops]) => {
    const bank = ops.filter((o) => o.bankInterest);
    const payments = ops.filter((o) => o.payment).map((o) => ({ date: o.date, amount: o.amount }));
    const first = payments[0];
    const annualRate = first && bank.length === 0 ? rateOn(first.date) : null;
    const journal = first && annualRate !== null ? (journalBefore.get(first.date) ?? null) : null;
    // The journal before this payment holds the adjustment when it is dated before the payment.
    const anchor = first && adjustedOn !== null && adjustedOn < first.date ? adjustedOn : null;
    const debtBefore =
      journal === null
        ? null
        : accrued
            .filter((a) => anchor === null || a.date > anchor)
            .reduce((d, a) => d.plus(a.interest), journal);
    const splits = splitLoanMonth({ payments, annualRate, debtBefore, bankInterest: bank.length > 0 });
    for (const sp of splits)
      if (!sp.interest.isZero()) accrued.push({ date: sp.date, interest: sp.interest });
    return {
      month,
      splits,
      bankInterest: bank,
      withoutRate: payments.length > 0 && bank.length === 0 && annualRate === null,
    };
  });
}

/** One amount of where the money went, in the report's currency at the rate of its date, in its month. */
export interface FlowLine {
  readonly month: Month;
  readonly kind: "goal" | "investment" | "withdrawal" | "debt" | "from-goals";
  readonly amount: Money;
  /** The goal of a contribution («goal»); null otherwise. */
  readonly goalId: string | null;
}

export interface Flows {
  /** FR 5: the contributions to goals, in all and by goal (in the order first contributed). */
  readonly goalContributions: Money;
  readonly byGoal: readonly { readonly goalId: string; readonly amount: Money }[];
  /** FR 6. */
  readonly investmentContributions: Money;
  readonly investmentWithdrawals: Money;
  /** FR 7: the principal of loan payments; not spending, so the savings rate does not change. */
  readonly debtRepayment: Money;
  /** FR 4: net flow − goals − investments − debt repayment; may be negative. */
  readonly leftOnAccounts: Money;
  /** FR 10, AC2: the spending paid from goals, part of the month's spending, shown as its own layer. */
  readonly fromGoals: Money;
}

function sumFlows(netFlow: Money, lines: readonly FlowLine[], currency: string): Flows {
  const zero = Money.zero(currency);
  const sum = (kind: FlowLine["kind"]) =>
    lines.filter((l) => l.kind === kind).reduce((t, l) => t.plus(l.amount), zero);
  const byGoal = new Map<string, Money>();
  for (const l of lines)
    if (l.kind === "goal" && l.goalId !== null)
      byGoal.set(l.goalId, (byGoal.get(l.goalId) ?? zero).plus(l.amount));
  const goalContributions = sum("goal");
  const investmentContributions = sum("investment");
  const debtRepayment = sum("debt");
  return {
    goalContributions,
    byGoal: [...byGoal].map(([goalId, amount]) => ({ goalId, amount })),
    investmentContributions,
    investmentWithdrawals: sum("withdrawal"),
    debtRepayment,
    leftOnAccounts: netFlow.minus(goalContributions).minus(investmentContributions).minus(debtRepayment),
    fromGoals: sum("from-goals"),
  };
}

/** FR 2, FR 4: each month's flows next to its figures. */
export function monthFlows(
  figures: readonly MonthFigures[],
  lines: readonly FlowLine[],
  currency: string,
): Flows[] {
  return figures.map((m) =>
    sumFlows(
      m.netFlow,
      lines.filter((l) => l.month === m.month),
      currency,
    ),
  );
}

/** FR 4, FR 11: the flows of the whole period. */
export function periodFlows(
  totals: PeriodTotals,
  months: readonly Month[],
  lines: readonly FlowLine[],
  currency: string,
): Flows {
  const inPeriod = new Set(months);
  return sumFlows(
    totals.netFlow,
    lines.filter((l) => inPeriod.has(l.month)),
    currency,
  );
}
