import { Money } from "@willowsum/domain-kernel";
import {
  addMonths,
  isPeriod,
  type BudgetIssue,
  type Period,
  type PeriodFigures,
  type PeriodPlan,
} from "./budget.ts";

/**
 * The method «Ліміти» and the month's plan (BUD-16@PoC a; wave 2 row 32). In this release the budget has one method,
 * «Ліміти» (FR 1): there is no method to store, choose or change, so nothing here knows of one — no method, no
 * history of methods, no marks of a change (FR 4). Pure; no I/O.
 */

/** The most months one trend request reads (lead decision 2026-11-19, BUD-16): «Усе» over 10 years at most. */
export const TREND_MONTHS_MAX = 120;

/** FR 4: the months of a trend, `from` to `to` inclusive, oldest first. */
export function trendPeriods(from: string, to: string): Period[] | BudgetIssue {
  if (!isPeriod(from)) return { field: "from", issue: "invalid" };
  if (!isPeriod(to) || to < from) return { field: "to", issue: "invalid" };
  const out: Period[] = [];
  for (let p = from; p <= to; p = addMonths(p, 1)) {
    if (out.length === TREND_MONTHS_MAX) return { field: "from", issue: "too_many_months" };
    out.push(p);
  }
  return out;
}

/**
 * FR 4: «План місяця» for history, trend and «факт / план» = the sum of the month's limits (a finished month — its
 * snapshot's). Filtered by a category — its limit; null — the category had none that month («Поза планом»), or the
 * month is before the budget (`plan` null).
 */
export function monthPlan(plan: PeriodPlan | null, currency: string, categoryId?: string): Money | null {
  if (plan === null) return null;
  if (categoryId !== undefined) return plan.limits.find((l) => l.categoryId === categoryId)?.amount ?? null;
  return plan.limits.reduce((t, l) => t.plus(l.amount), Money.zero(currency));
}

/** A month before the budget: no limits, so its figures are spending and income only. */
export const emptyPlan = (currency: string): PeriodPlan => ({
  incomePlan: Money.zero(currency),
  plannedSavings: Money.zero(currency),
  limits: [],
});

/** One month of the trend: the plan line, the spending bar and the income line (facts only, FR 5). */
export interface TrendLine {
  readonly plan: Money | null;
  /** Every expense category's spending, «Поза планом» and «Без категорії» included; null — a future month. */
  readonly spent: Money | null;
  /** The month's income; null — a future month. */
  readonly income: Money | null;
}

/** FR 4: a month of the trend from its figures (`periodFigures`); `plan` null — before the budget. */
export function trendLine(
  plan: PeriodPlan | null,
  figures: PeriodFigures,
  currency: string,
  categoryId?: string,
): TrendLine {
  const t = figures.totals;
  let spent: Money | null = null;
  if (t.spent !== null && t.outsidePlan !== null)
    spent =
      categoryId === undefined
        ? t.spent.plus(t.outsidePlan)
        : (figures.lines.find((l) => l.categoryId === categoryId)?.spent ??
          figures.outsidePlan.find((o) => o.categoryId === categoryId)?.spent ??
          Money.zero(currency));
  return { plan: monthPlan(plan, currency, categoryId), spent, income: t.incomeActual };
}
