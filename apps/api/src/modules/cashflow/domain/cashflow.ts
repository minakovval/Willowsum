import { Decimal, Money } from "@willowsum/domain-kernel";

/**
 * Pure rules of «Грошовий потік» (BUD-08@PoC; wave 2 row 37, server part a): the period types and their months (FR 1,
 * FR 12), what is income and what is spending (FR 8, FR 9, FR 13, business rules), net flow and the savings rate of a
 * month (FR 3) and of a period (FR 11). No I/O.
 */

/** FR 1: the period types of the tab; «Власний» is not one of them. */
export const PERIOD_TYPES = ["month", "quarter", "ytd", "year"] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];

/** A calendar month, YYYY-MM (FR 12). */
export type Month = string;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const YEAR_RE = /^(\d{4})$/;

const month = (year: number, m: number): Month =>
  `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
const range = (year: number, first: number, last: number): Month[] =>
  Array.from({ length: last - first + 1 }, (_, i) => month(year, first + i));

/**
 * FR 1, FR 12: the calendar months of a period — `month` YYYY-MM (one), `quarter` YYYY-Qn (its 3), `year` YYYY (its 12),
 * `ytd` YYYY (January to the current month of the current year; a past year — all 12). A malformed period, a year before
 * 1900 or a period that starts after the current month is null.
 */
export function monthsOf(type: PeriodType, period: string, today: string): readonly Month[] | null {
  const current = today.slice(0, 7);
  let months: Month[] | null = null;
  if (type === "month" && MONTH_RE.test(period)) months = [period];
  const q = QUARTER_RE.exec(period);
  if (type === "quarter" && q) {
    const first = (Number(q[2]) - 1) * 3 + 1;
    months = range(Number(q[1]), first, first + 2);
  }
  if ((type === "year" || type === "ytd") && YEAR_RE.test(period)) {
    const year = Number(period);
    const last = type === "ytd" && period === current.slice(0, 4) ? Number(current.slice(5, 7)) : 12;
    months = range(year, 1, last);
  }
  if (!months || months[0]! < "1900-01" || months[0]! > current) return null;
  return months;
}

/** FR 1: the type decides the view — «Місяць» for a month, «Помісячно» on the months of a longer period. */
export const viewOf = (type: PeriodType): "month" | "monthly" => (type === "month" ? "month" : "monthly");

/** A category as «Грошовий потік» reads the space's tree (module categories). */
export interface CashflowCategory {
  readonly id: string;
  readonly kind: "expense" | "income" | "service";
  readonly state: "active" | "hidden" | "retired";
  readonly mergedInto: string | null;
}

/**
 * One amount the screen counts, already in the report's currency at the rate of its date (FR 12): a transaction of a
 * budget account, or one part of a split by categories, in its month of payment (FR 13), with its category (null —
 * «Без категорії»).
 */
export interface CountedLine {
  readonly month: Month;
  readonly categoryId: string | null;
  readonly amount: Money;
}

export interface MonthFigures {
  readonly month: Month;
  readonly income: Money;
  readonly expenses: Money;
  /** FR 3: income − expenses. */
  readonly netFlow: Money;
  /** FR 3: (income − expenses) ÷ income in per cent, unrounded; null without income («–»). */
  readonly savingsRate: Decimal | null;
  /** FR 9: the uncategorized inflows that lowered the expenses (the screen's hint). */
  readonly uncategorizedInflows: { readonly count: number; readonly amount: Money };
}

/** A merged category counts in the one it went to (BUD-01 FR 8); at most a few hops. */
function resolve(
  categories: ReadonlyMap<string, CashflowCategory>,
  id: string | null,
): CashflowCategory | null {
  let c = id === null ? undefined : categories.get(id);
  for (let i = 0; c && c.state === "retired" && i < 8; i++)
    c = c.mergedInto ? categories.get(c.mergedInto) : undefined;
  return c && c.state !== "retired" ? c : null;
}

const HUNDRED = new Decimal("100");

/** FR 3: (income − expenses) ÷ income × 100; null when there is no income (zero or less). */
export function savingsRate(income: Money, expenses: Money): Decimal | null {
  if (income.isNegative() || income.isZero()) return null;
  return income.minus(expenses).amount.div(income.amount).times(HUNDRED);
}

/** FR 3: one digit after the point, rounded half to even (owner decision 2026-11-16). */
export const ratePercent = (rate: Decimal | null): string | null =>
  rate === null ? null : rate.toDecimalPlaces(1, Decimal.ROUND_HALF_EVEN).toFixed(1);

/**
 * FR 8, FR 9, business rules: income is the inflows of income categories less their outflows; spending is the outflows
 * of expense categories less their refunds, and an uncategorized amount counts in spending — an outflow raises it, an
 * inflow lowers it (as in the budget), never income. Service categories («Переказ» — one-sided transfers and card
 * payments — and «Коригування») are neither. Every month of `months` has its figures, empty ones with zeros.
 */
export function monthFigures(
  months: readonly Month[],
  lines: readonly CountedLine[],
  categories: ReadonlyMap<string, CashflowCategory>,
  currency: string,
): MonthFigures[] {
  const zero = Money.zero(currency);
  const sums = new Map(
    months.map((m) => [m, { income: zero, expenses: zero, inflowCount: 0, inflow: zero }]),
  );
  for (const line of lines) {
    const s = sums.get(line.month);
    if (!s) continue;
    const c = resolve(categories, line.categoryId);
    if (c?.kind === "service") continue;
    if (c?.kind === "income") s.income = s.income.plus(line.amount);
    else {
      s.expenses = s.expenses.minus(line.amount);
      if (!c && !line.amount.isNegative() && !line.amount.isZero()) {
        s.inflowCount += 1;
        s.inflow = s.inflow.plus(line.amount);
      }
    }
  }
  return months.map((m) => {
    const s = sums.get(m)!;
    return {
      month: m,
      income: s.income,
      expenses: s.expenses,
      netFlow: s.income.minus(s.expenses),
      savingsRate: savingsRate(s.income, s.expenses),
      uncategorizedInflows: { count: s.inflowCount, amount: s.inflow },
    };
  });
}

export interface PeriodTotals {
  readonly income: Money;
  readonly expenses: Money;
  readonly netFlow: Money;
  /** FR 11: (Σ income − Σ expenses) ÷ Σ income over every month of the period; null without income. */
  readonly savingsRate: Decimal | null;
  /** FR 11: the mean of the monthly rates over the months with income; null when no month has income. */
  readonly averageMonthlyRate: Decimal | null;
  /** FR 10: the months with the highest and the lowest net flow (the charts' descriptions); null for no months. */
  readonly highest: Month | null;
  readonly lowest: Month | null;
}

export function periodTotals(months: readonly MonthFigures[], currency: string): PeriodTotals {
  const zero = Money.zero(currency);
  const income = months.reduce((t, m) => t.plus(m.income), zero);
  const expenses = months.reduce((t, m) => t.plus(m.expenses), zero);
  const rates = months.map((m) => m.savingsRate).filter((r): r is Decimal => r !== null);
  let highest: MonthFigures | null = null;
  let lowest: MonthFigures | null = null;
  for (const m of months) {
    if (!highest || m.netFlow.compare(highest.netFlow) > 0) highest = m;
    if (!lowest || m.netFlow.compare(lowest.netFlow) < 0) lowest = m;
  }
  return {
    income,
    expenses,
    netFlow: income.minus(expenses),
    savingsRate: savingsRate(income, expenses),
    averageMonthlyRate:
      rates.length === 0
        ? null
        : rates.reduce((t, r) => t.plus(r), new Decimal("0")).div(String(rates.length)),
    highest: highest?.month ?? null,
    lowest: lowest?.month ?? null,
  };
}
