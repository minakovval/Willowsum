import { Decimal, type Money } from "@willowsum/domain-kernel";

/**
 * FLW-38@PoC FR 1, AC5, EC1 (S-135 «Підсумок періоду», the cards over the categories): a finished period's income and
 * expenses against the plan, the net flow and the savings rate, from the same figures as the categories table
 * (BUD-02 FR 16: the plan from the snapshot, the fact live). No I/O.
 */
export interface SummaryFigures {
  /** The plan of income (the snapshot's). */
  readonly incomePlan: Money;
  /** The income of the budget accounts in the period. */
  readonly incomeActual: Money;
  /** The sum of the limits (the snapshot's). */
  readonly limits: Money;
  /** Spent in the categories with a limit. */
  readonly spentLimited: Money;
  /** Spent outside the plan: categories without a limit and «Без категорії». */
  readonly outsidePlan: Money;
}

export interface PlanAgainstFact {
  readonly actual: Money;
  readonly plan: Money;
  /** Actual − plan: positive — above the plan («▲»), negative — below it («▼»). */
  readonly difference: Money;
}

export interface PeriodSummary {
  readonly income: PlanAgainstFact;
  /** Every expense of the period: the limited categories and «Поза планом»; the plan is the sum of the limits. */
  readonly expenses: PlanAgainstFact;
  /** Income − expenses; negative — more spent than earned. */
  readonly netFlow: Money;
  /** (income − expenses) ÷ income × 100, one digit after the point, half to even; null without income (EC1 «–»). */
  readonly savingsRate: string | null;
}

const HUNDRED = new Decimal("100");

/** FLW-38 FR 1, AC5: one digit after the point, half to even (as BUD-08's «Грошовий потік»); EC1: no income — null. */
export function savingsRatePercent(income: Money, expenses: Money): string | null {
  if (income.isNegative() || income.isZero()) return null;
  return income
    .minus(expenses)
    .amount.div(income.amount)
    .times(HUNDRED)
    .toDecimalPlaces(1, Decimal.ROUND_HALF_EVEN)
    .toFixed(1);
}

export function periodSummary(f: SummaryFigures): PeriodSummary {
  const expenses = f.spentLimited.plus(f.outsidePlan);
  return {
    income: { actual: f.incomeActual, plan: f.incomePlan, difference: f.incomeActual.minus(f.incomePlan) },
    expenses: { actual: expenses, plan: f.limits, difference: expenses.minus(f.limits) },
    netFlow: f.incomeActual.minus(expenses),
    savingsRate: savingsRatePercent(f.incomeActual, expenses),
  };
}

/** A charge as the card «Регулярні платежі» of a finished period lists it. */
export interface SummaryCharge {
  readonly paymentId: string;
  readonly type: "expense" | "income";
  readonly categoryId: string | null;
  readonly dueOn: string;
  readonly expected: Money;
  readonly status: "paid" | "paid-late" | "expected" | "overdue" | "skipped";
  readonly overdueDays: number | null;
  readonly paidOn: string | null;
}

export interface SummaryRegularPayments {
  /** «сплачено N з M»: M. */
  readonly count: number;
  /** N: paid on time or late. */
  readonly paid: number;
  /** «K із запізненням». */
  readonly late: number;
  /** Not paid: «Прострочено» or «Пропущено». */
  readonly missed: number;
  /** By date: the month's charges of the expense payments. */
  readonly items: readonly SummaryCharge[];
}

/**
 * FLW-38 FR 1 (S-135 «Регулярні платежі»: «<місяць> · сплачено N з M · K із запізненням»): the expense payments' charges
 * of the month — the regular incomes are the income card's (BUD-02 FR 3), not this card's.
 */
export function regularPaymentsOf(charges: readonly SummaryCharge[]): SummaryRegularPayments {
  const items = charges
    .filter((c) => c.type === "expense")
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.paymentId.localeCompare(b.paymentId));
  const count = (...statuses: SummaryCharge["status"][]) =>
    items.filter((c) => statuses.includes(c.status)).length;
  return {
    count: items.length,
    paid: count("paid", "paid-late"),
    late: count("paid-late"),
    missed: count("overdue", "skipped"),
    items,
  };
}
