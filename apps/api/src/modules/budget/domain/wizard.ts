import { currencyInfo, Decimal, Money } from "@willowsum/domain-kernel";
import {
  addMonths,
  limitIssue,
  periodDays,
  periodFigures,
  periodOf,
  type BudgetCategory,
  type CountedAmount,
  type Period,
  type PeriodPlan,
} from "./budget.ts";

/**
 * Pure rules of the budget wizard (BUD-02@PoC b; wave 2 row 30): the start of the first period — mid-period choices and
 * the proportional first period (FR 5, FR 14) — and the proposal «Створити за моїми витратами» (FR 2, FR 3, edge cases
 * 1–2). No I/O.
 */

/** FR 3: half up to whole tens of the currency's units (assumption of the requirement: any reporting currency). */
export function roundToTen(amount: Decimal, currency: string): Money {
  return Money.of(amount.div(10).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(10), currency);
}

/** Half up to the currency's minor units: a plan the wizard proposes or scales is a storable amount (lead decision). */
export function roundToMinor(amount: Decimal, currency: string): Money {
  return Money.of(amount.toDecimalPlaces(currencyInfo(currency).minorUnits, Decimal.ROUND_HALF_UP), currency);
}

/** FR 14: the part of the first period the budget covers — from `from` to the period's last day, both included. */
export interface PeriodShare {
  readonly from: string;
  readonly to: string;
  readonly days: number;
  readonly daysInPeriod: number;
}

export const dayOf = (date: string): number => Number(date.slice(8, 10));

export function shareFrom(from: string): PeriodShare {
  const { to } = periodDays(periodOf(from));
  const daysInPeriod = dayOf(to);
  return { from, to, days: daysInPeriod - dayOf(from) + 1, daysInPeriod };
}

/** FR 14: «З 1 <місяця>», «З наступного місяця (1 <місяця>)», «Пропорційно на <день>–<останній> (<дні>/<днів>)». */
export interface StartChoice {
  readonly start: "period-start" | "next-period" | "proportional";
  readonly firstPeriod: Period;
  /** The first counted day: the 1st of the first period, or today for a proportional one. */
  readonly from: string;
  readonly to: string;
  /** Proportional only: the days left, today included, and the days of the period (13/30). */
  readonly days: number | null;
  readonly daysInPeriod: number | null;
}

/**
 * FR 5, FR 14, AC15, edge case 3: on the 1st of a month the first period is the current one — no choice; any other day
 * the block «Ви починаєте посеред періоду» offers three starts and none is the default (the order is the requirement's).
 */
export function startChoices(today: string): {
  readonly midPeriod: boolean;
  readonly choices: readonly StartChoice[];
} {
  const current = periodOf(today);
  const whole = (start: StartChoice["start"], p: Period): StartChoice => ({
    start,
    firstPeriod: p,
    ...periodDays(p),
    days: null,
    daysInPeriod: null,
  });
  if (dayOf(today) === 1) return { midPeriod: false, choices: [whole("period-start", current)] };
  const share = shareFrom(today);
  return {
    midPeriod: true,
    choices: [
      whole("period-start", current),
      whole("next-period", addMonths(current, 1)),
      {
        start: "proportional",
        firstPeriod: current,
        from: share.from,
        to: share.to,
        days: share.days,
        daysInPeriod: share.daysInPeriod,
      },
    ],
  };
}

/**
 * FR 14: in a proportional first period the limits, the income plan and the planned savings are multiplied by (days
 * left, today included) ÷ (days in the period); each amount half up to the currency's minor units (lead decision).
 */
export function scalePlan(plan: PeriodPlan, share: PeriodShare): PeriodPlan {
  const scale = (m: Money) => roundToMinor(m.amount.times(share.days).div(share.daysInPeriod), m.currency);
  return {
    incomePlan: scale(plan.incomePlan),
    plannedSavings: scale(plan.plannedSavings),
    limits: plan.limits.map((l) => ({ ...l, amount: scale(l.amount) })),
  };
}

/** One full month of history as the wizard reads it: income and spending by active expense category. */
export interface MonthHistory {
  readonly period: Period;
  /** At least one counted transaction with a category. */
  readonly categorized: boolean;
  readonly income: Money;
  readonly spent: ReadonlyMap<string, Money>;
}

/** The full months the wizard reads, newest first: the 6 before the current one (edge case 1 needs 6). */
export const HISTORY_MONTHS = 6;
export const historyPeriods = (today: string): Period[] =>
  Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(periodOf(today), -1 - i));

/**
 * A month's figures over the same rules as a period (FR 12; merged categories in their target, service ones neither
 * income nor spending): the spending of each category a limit can have (an active expense one) and the income.
 */
export function monthHistory(
  period: Period,
  currency: string,
  categories: ReadonlyMap<string, BudgetCategory>,
  amounts: readonly CountedAmount[],
): MonthHistory {
  const empty: PeriodPlan = {
    incomePlan: Money.zero(currency),
    plannedSavings: Money.zero(currency),
    limits: [],
  };
  const figures = periodFigures(empty, categories, amounts);
  const spent = new Map<string, Money>();
  for (const o of figures.outsidePlan)
    if (o.categoryId !== null && limitIssue(categories.get(o.categoryId)) === null)
      spent.set(o.categoryId, o.spent);
  return {
    period,
    categorized: amounts.some((a) => a.categoryId !== null),
    income: figures.totals.incomeActual ?? Money.zero(currency),
    spent,
  };
}

/**
 * FR 2: how many full months back from the last one have categorized transactions, without a gap (at most 6).
 * «Створити за моїми витратами» needs 3.
 */
export function historyMonths(months: readonly MonthHistory[]): number {
  let n = 0;
  while (n < months.length && months[n]!.categorized) n++;
  return n;
}

export const MIN_HISTORY_MONTHS = 3;

/** A category's line of the proposal: the 3-month average (the hint of FR 7) and the limit proposed from it. */
export interface ProposedLimit {
  readonly categoryId: string;
  /** The average spending of the 3 full months, half up to minor units. */
  readonly average: Money;
  /** FR 3: the average half up to tens; null when that is 0 — the category stays in «Поза планом» (lead decision). */
  readonly limit: Money | null;
}

export interface Proposal {
  readonly available: boolean;
  readonly historyMonths: number;
  /** FR 3: the average income of the 3 months; edge case 1 — the lowest month of 6 for an irregular income. */
  readonly incomePlan: Money | null;
  readonly incomeIrregular: boolean;
  readonly limits: readonly ProposedLimit[];
}

/**
 * Edge case 1: the income is irregular when at least 2 of the last 6 full months differ from their 6-month average by
 * more than 30 %. Needs 6 months of history; with fewer the income counts as regular (lead decision).
 */
export function incomeIrregular(months: readonly MonthHistory[]): boolean {
  if (months.length < HISTORY_MONTHS || historyMonths(months) < HISTORY_MONTHS) return false;
  const six = months.slice(0, HISTORY_MONTHS).map((m) => m.income.amount);
  const average = six.reduce((t, x) => t.plus(x), new Decimal("0")).div(HISTORY_MONTHS);
  const band = average.times("0.3");
  return six.filter((x) => x.minus(average).abs().greaterThan(band)).length >= 2;
}

/**
 * FR 2, FR 3, AC1, edge cases 1–2: «Створити за моїми витратами» — with at least 3 full months of categorized history,
 * a limit for each active expense category = its average spending over the last 3 full months, half up to tens; the
 * income plan = the average income of those months (irregular — the lowest month of 6). Without the history only
 * «Почати з нуля». `months` — the 6 full months before the current one, newest first.
 */
export function proposeFromSpending(currency: string, months: readonly MonthHistory[]): Proposal {
  const history = historyMonths(months);
  if (history < MIN_HISTORY_MONTHS)
    return { available: false, historyMonths: history, incomePlan: null, incomeIrregular: false, limits: [] };
  const three = months.slice(0, MIN_HISTORY_MONTHS);
  const totals = new Map<string, Decimal>();
  for (const m of three)
    for (const [id, s] of m.spent) totals.set(id, (totals.get(id) ?? new Decimal("0")).plus(s.amount));
  const limits: ProposedLimit[] = [];
  for (const [categoryId, total] of totals) {
    const exact = total.div(MIN_HISTORY_MONTHS);
    if (!exact.greaterThan(0)) continue;
    const limit = roundToTen(exact, currency);
    limits.push({
      categoryId,
      average: roundToMinor(exact, currency),
      limit: limit.isZero() ? null : limit,
    });
  }
  const irregular = incomeIrregular(months);
  const income = irregular
    ? Decimal.min(...months.slice(0, HISTORY_MONTHS).map((m) => m.income.amount))
    : three.reduce((t, m) => t.plus(m.income.amount), new Decimal("0")).div(MIN_HISTORY_MONTHS);
  return {
    available: true,
    historyMonths: history,
    incomePlan: roundToMinor(Decimal.max(income, "0"), currency),
    incomeIrregular: irregular,
    limits,
  };
}
