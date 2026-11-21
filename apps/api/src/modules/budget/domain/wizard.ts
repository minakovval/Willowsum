import { currencyInfo, Decimal, Money } from "@willowsum/domain-kernel";
import {
  addMonths,
  categoryTotals,
  incomePlansTotal,
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

/**
 * FR 3: to whole tens of the currency's units, an exact half to the even number of tens — 405 → 400, 415 → 420 (owner
 * decision 2026-11-16; assumption of the requirement: any reporting currency). Wave 2 row 179.
 */
export function roundToTen(amount: Decimal, currency: string): Money {
  return Money.of(amount.div(10).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).times(10), currency);
}

/**
 * To the currency's minor units, an exact half to the even one (owner decision 2026-11-16, wave 2 row 179): a plan the
 * wizard proposes or scales is a storable amount (lead decision).
 */
export function roundToMinor(amount: Decimal, currency: string): Money {
  return Money.of(
    amount.toDecimalPlaces(currencyInfo(currency).minorUnits, Decimal.ROUND_HALF_EVEN),
    currency,
  );
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
 * left, today included) ÷ (days in the period); each amount to the currency's minor units, an exact half to even.
 */
export function scalePlan(plan: PeriodPlan, share: PeriodShare): PeriodPlan {
  const scale = (m: Money) => roundToMinor(m.amount.times(share.days).div(share.daysInPeriod), m.currency);
  // FR 21: by category — each category's plan scaled, and the income plan their sum (it stays the sum of the lines).
  const incomePlans = plan.incomePlans?.map((l) => ({ ...l, amount: scale(l.amount) }));
  return {
    incomePlan:
      incomePlans && incomePlans.length > 0
        ? incomePlansTotal(incomePlans, plan.incomePlan.currency)
        : scale(plan.incomePlan),
    ...(incomePlans ? { incomePlans } : {}),
    plannedSavings: scale(plan.plannedSavings),
    limits: plan.limits.map((l) => ({ ...l, amount: scale(l.amount) })),
  };
}

/** One full month of history as the wizard reads it: income by income category, spending by active expense category. */
export interface MonthHistory {
  readonly period: Period;
  /** At least one counted transaction with a category. */
  readonly categorized: boolean;
  readonly income: Money;
  /** FR 3, FR 21, EC1: the income of each active income category (a merged one in its target). */
  readonly incomeByCategory: ReadonlyMap<string, Money>;
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
  const incomeByCategory = new Map<string, Money>();
  for (const [id, t] of categoryTotals(categories, amounts, currency).income)
    if (categories.get(id)?.state === "active") incomeByCategory.set(id, t.amount);
  return {
    period,
    categorized: amounts.some((a) => a.categoryId !== null),
    income: figures.totals.incomeActual ?? Money.zero(currency),
    incomeByCategory,
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

/**
 * FR 3, FR 21, EC1: an income category's line of «План доходу» — its 3-month average (the hint of the field) and the
 * plan proposed: the average to tens, or for an irregular category its lowest month of 6 to tens.
 */
export interface ProposedIncome {
  readonly categoryId: string;
  /** The average income of the 3 full months (of the months it has, for a shorter history — EC1), to minor units. */
  readonly average: Money;
  readonly plan: Money;
  /** EC1: the category's income is irregular (a gap since its first income, or 2 of 6 months off by more than 30 %). */
  readonly irregular: boolean;
}

export interface Proposal {
  readonly available: boolean;
  readonly historyMonths: number;
  /** FR 3, FR 21: the sum of the income categories' plans. */
  readonly incomePlan: Money | null;
  /** EC1: at least one income category is irregular. */
  readonly incomeIrregular: boolean;
  /** FR 21: the income categories with income in the 3 months, the largest plan first. */
  readonly incomes: readonly ProposedIncome[];
  readonly limits: readonly ProposedLimit[];
}

const incomeOf = (m: MonthHistory, categoryId: string): Decimal =>
  m.incomeByCategory.get(categoryId)?.amount ?? new Decimal("0");

/**
 * Edge case 1 (lead decision 2026-11-21): the full months of an income category's history — from the newest back to
 * its oldest month with income, within the categorized history without a gap (FR 2); 0 without income there.
 */
export function incomeMonths(months: readonly MonthHistory[], categoryId: string): number {
  for (let i = historyMonths(months) - 1; i >= 0; i--)
    if (!incomeOf(months[i]!, categoryId).isZero()) return i + 1;
  return 0;
}

/**
 * Edge case 1 (lead decision 2026-11-21): the category had no income in a month since its first income in the history
 * (`incomeMonths`) — a gap, as a quarterly bonus has.
 */
export function incomeGaps(months: readonly MonthHistory[], categoryId: string): boolean {
  const own = incomeMonths(months, categoryId);
  for (let i = 0; i < own; i++) if (incomeOf(months[i]!, categoryId).isZero()) return true;
  return false;
}

/**
 * Edge case 1, per income category (lead decisions 2026-11-16 and 2026-11-21): the category's income is irregular when
 * it has a gap since its first income (`incomeGaps`: 500, 0, 0, 500, 0, 0 € is irregular), or when, with 6 full
 * months of its history (`incomeMonths`), at least 2 of the last 6 full months differ from its 6-month average by more
 * than 30 %. A category with fewer than 6 months and income in every one of them is «new», not irregular.
 */
export function incomeIrregular(months: readonly MonthHistory[], categoryId: string): boolean {
  if (incomeGaps(months, categoryId)) return true;
  if (incomeMonths(months, categoryId) < HISTORY_MONTHS) return false;
  const six = months.slice(0, HISTORY_MONTHS).map((m) => incomeOf(m, categoryId));
  const average = six.reduce((t, x) => t.plus(x), new Decimal("0")).div(HISTORY_MONTHS);
  const band = average.times("0.3");
  return six.filter((x) => x.minus(average).abs().greaterThan(band)).length >= 2;
}

/**
 * FR 2, FR 3, FR 21, AC1, AC18, edge cases 1–2: «Створити за моїми витратами» — with at least 3 full months of
 * categorized history, a limit for each active expense category = its average spending over the last 3 full months, to
 * tens (an exact half to even); a plan for each income category with income in those months = its average to tens
 * (over the months of its history, at most 3 — edge case 1, lead decision 2026-11-21), or for an irregular category its
 * lowest month of 6 to tens; the income plan = the sum of the categories' plans. Without
 * the history only «Почати з нуля». `months` — the 6 full months before the current one, newest first.
 */
export function proposeFromSpending(currency: string, months: readonly MonthHistory[]): Proposal {
  const history = historyMonths(months);
  if (history < MIN_HISTORY_MONTHS)
    return {
      available: false,
      historyMonths: history,
      incomePlan: null,
      incomeIrregular: false,
      incomes: [],
      limits: [],
    };
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
  const incomeIds = [...new Set(three.flatMap((m) => [...m.incomeByCategory.keys()]))];
  const incomes: ProposedIncome[] = [];
  for (const categoryId of incomeIds) {
    // Edge case 1 (lead decision 2026-11-21): a category with a shorter history averages the months it has.
    const own = Math.min(MIN_HISTORY_MONTHS, incomeMonths(months, categoryId));
    if (own === 0) continue;
    const exact = three.reduce((t, m) => t.plus(incomeOf(m, categoryId)), new Decimal("0")).div(own);
    // FR 21: the categories that had income in the 3 months.
    if (!exact.greaterThan(0)) continue;
    const irregular = incomeIrregular(months, categoryId);
    const base = irregular
      ? Decimal.max(Decimal.min(...months.slice(0, HISTORY_MONTHS).map((m) => incomeOf(m, categoryId))), "0")
      : exact;
    incomes.push({
      categoryId,
      average: roundToMinor(exact, currency),
      plan: roundToTen(base, currency),
      irregular,
    });
  }
  // The largest plan first, then the larger average; the category's id last — one order on every read.
  incomes.sort(
    (a, b) =>
      b.plan.compare(a.plan) || b.average.compare(a.average) || (a.categoryId < b.categoryId ? -1 : 1),
  );
  return {
    available: true,
    historyMonths: history,
    incomePlan: incomePlansTotal(
      incomes.map((i) => ({ categoryId: i.categoryId, amount: i.plan })),
      currency,
    ),
    incomeIrregular: incomes.some((i) => i.irregular),
    incomes,
    limits,
  };
}
