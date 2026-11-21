import { currencyInfo, Decimal, DomainError, isCurrencyCode, Money } from "@willowsum/domain-kernel";

/**
 * Pure rules of the space's budget (BUD-02@PoC a; wave 2 row 29): the calendar month as the only period (FR 4, FR 6),
 * which accounts count by default (FR 10), what a period shows — limits, spent, «Поза планом» (FR 7, FR 9, FR 12) —
 * and the plan a finished period keeps (FR 11). No I/O.
 */

/** A budget period: a calendar month, `YYYY-MM` (FR 4, FR 6). */
export type Period = string;

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const isPeriod = (text: string): boolean => PERIOD_RE.test(text);
export const periodOf = (date: string): Period => date.slice(0, 7);

export function addMonths(period: Period, months: number): Period {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + months;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The first and the last day of the period, YYYY-MM-DD. */
export function periodDays(period: Period): { readonly from: string; readonly to: string } {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}

/** FR 16: the current period — the full budget; a past one — plan against fact; a future one — the plan only. */
export function periodMode(period: Period, today: string): "past" | "current" | "future" {
  const current = periodOf(today);
  return period < current ? "past" : period === current ? "current" : "future";
}

/**
 * FR 5, FR 14: the first period is the current month or, from the 2nd of the month on, the next one; on the 1st it is
 * the current one (no mid-period choice). The proportional start is a share of the current month (domain/wizard.ts).
 */
export const firstPeriodChoices = (today: string): readonly Period[] =>
  today.endsWith("-01") ? [periodOf(today)] : [periodOf(today), addMonths(periodOf(today), 1)];

/** The finished periods since the first one that have no snapshot yet (FR 11), oldest first. */
export function periodsToSnapshot(
  firstPeriod: Period,
  today: string,
  snapshotted: ReadonlySet<Period>,
): Period[] {
  const out: Period[] = [];
  for (let p = firstPeriod; p < periodOf(today); p = addMonths(p, 1)) if (!snapshotted.has(p)) out.push(p);
  return out;
}

/** FR 10: by default the budget takes current accounts (multi-currency ones too), credit cards and cash. */
export const DEFAULT_BUDGET_KINDS: readonly string[] = ["current", "credit-card", "cash"];
export const includedByDefault = (kind: string): boolean => DEFAULT_BUDGET_KINDS.includes(kind);

/**
 * At most 15 integer digits: a sum of every amount one request or one plan holds (≤ 300 limits, an income plan, ≤ 100
 * chosen) stays within NUMERIC(38,18), so a total never overflows into a 500 (#565).
 */
export const AMOUNT_INTEGER_DIGITS_MAX = 15;
const AMOUNT_RE = /^\d{1,15}(?:\.\d{1,18})?$/;

export interface BudgetIssue {
  readonly field: string;
  readonly issue: string;
}

/** A limit or an income plan as typed: ≥ 0, in the budget's currency (FR 1), at most its minor units. */
export function parseBudgetAmount(
  field: string,
  input: { readonly amount: string; readonly currency: string },
  currency: string,
): Money | BudgetIssue {
  if (input.currency !== currency) return { field: `${field}.currency`, issue: "currency" };
  if (!AMOUNT_RE.test(input.amount) || !isCurrencyCode(currency)) return { field, issue: "invalid" };
  const amount = new Decimal(input.amount);
  if (amount.decimalPlaces() > currencyInfo(currency).minorUnits) return { field, issue: "invalid" };
  try {
    return Money.of(amount, currency);
  } catch (error) {
    if (error instanceof DomainError) return { field, issue: "invalid" };
    throw error;
  }
}

/** A category as the budget reads the space's tree (module categories). */
export interface BudgetCategory {
  readonly id: string;
  readonly groupId: string;
  readonly kind: "expense" | "income" | "service";
  readonly state: "active" | "hidden" | "retired";
  readonly mergedInto: string | null;
  readonly essential: boolean | null;
}

/** FR 7: a limit belongs to an active expense category of the space; a hidden one is out of the plan (BUD-01). */
export function limitIssue(category: BudgetCategory | undefined): string | null {
  if (!category || category.state === "retired") return "not_found";
  if (category.kind !== "expense") return "not_expense";
  return category.state === "hidden" ? "hidden" : null;
}

/**
 * FR 21: the income plan of one income category for the month. The budget's income plan is the sum of these lines; a
 * budget saved before them (or with `incomePlan` alone) has its plan without categories.
 */
export interface IncomePlanLine {
  readonly categoryId: string;
  readonly amount: Money;
}

/** FR 21: an income plan belongs to an active income category of the space; a hidden one is out of the plan. */
export function incomePlanIssue(category: BudgetCategory | undefined): string | null {
  if (!category || category.state === "retired") return "not_found";
  if (category.kind !== "income") return "not_income";
  return category.state === "hidden" ? "hidden" : null;
}

/** FR 21: the income plan of the lines — their sum. */
export const incomePlansTotal = (lines: readonly IncomePlanLine[], currency: string): Money =>
  lines.reduce((t, l) => t.plus(l.amount), Money.zero(currency));

/** The plan of a period: live for the current and future ones, the snapshot for a finished one (FR 11). */
export interface PeriodPlan {
  /** The month's income plan: the sum of `incomePlans` (FR 21), or the plan without categories. */
  readonly incomePlan: Money;
  /**
   * FR 11, FR 21: the plan of each income category; left out or empty — the plan has no categories (a budget or a
   * snapshot saved before them).
   */
  readonly incomePlans?: readonly IncomePlanLine[];
  /** FR 11: planned contributions to goals and «Заощадження без цілі» — planned by «Розподіл» (row 31); 0 until then. */
  readonly plannedSavings: Money;
  readonly limits: readonly {
    readonly categoryId: string;
    readonly amount: Money;
    readonly mandatory: boolean;
  }[];
}

/**
 * One amount the budget counts, in the budget's currency (FR 12; business rules: converted at the rate of its date):
 * a transaction of a budget account or one part of a split one, with its category (null — «Без категорії»).
 */
export interface CountedAmount {
  readonly categoryId: string | null;
  readonly amount: Money;
}

/** A category's line of the table (FR 9): limit, spent and what is left (negative — over the limit). */
export interface LimitLine {
  readonly categoryId: string;
  readonly groupId: string | null;
  readonly mandatory: boolean;
  readonly limit: Money;
  readonly spent: Money | null;
  readonly remaining: Money | null;
}

export interface PeriodFigures {
  readonly lines: readonly LimitLine[];
  /** «Поза планом» (FR 7, AC5): expense categories without a limit that have spending; null — «Без категорії». */
  readonly outsidePlan: readonly { readonly categoryId: string | null; readonly spent: Money }[];
  readonly totals: {
    readonly limits: Money;
    readonly spent: Money | null;
    readonly outsidePlan: Money | null;
    readonly incomeActual: Money | null;
  };
}

/** A retired (merged) category counts in the one it went to (BUD-01 FR 8); at most a few hops. */
export function resolveCategory(
  categories: ReadonlyMap<string, BudgetCategory>,
  id: string | null,
): BudgetCategory | null {
  let c = id === null ? undefined : categories.get(id);
  for (let i = 0; c && c.state === "retired" && i < 8; i++)
    c = c.mergedInto ? categories.get(c.mergedInto) : undefined;
  return c && c.state !== "retired" ? c : null;
}

/** What one category adds up to: the amount and how many amounts (transactions or split parts) made it. */
export interface Tally {
  readonly amount: Money;
  readonly count: number;
}

/** The counted amounts by category: spending of expense categories (null — «Без категорії») and income by category. */
export interface CategoryTotals {
  readonly spent: ReadonlyMap<string | null, Tally>;
  readonly income: ReadonlyMap<string, Tally>;
}

/**
 * FR 12, edge case 4: spending of an expense category is its outflows less its refunds; income — the inflows of income
 * categories less their outflows; service categories («Переказ», «Коригування») are neither. An uncategorized outflow
 * is spending «Без категорії», an uncategorized inflow is not income (lead decision). A merged category counts in the
 * one it went to (BUD-01 FR 8). The one tally of the period (`periodFigures`) and of «Порівняння» (BUD-06).
 */
export function categoryTotals(
  categories: ReadonlyMap<string, BudgetCategory>,
  amounts: readonly CountedAmount[],
  currency: string,
): CategoryTotals {
  const zero = Money.zero(currency);
  const spent = new Map<string | null, Tally>();
  const income = new Map<string, Tally>();
  const add = <K>(map: Map<K, Tally>, key: K, amount: Money) => {
    const t = map.get(key);
    map.set(key, { amount: (t?.amount ?? zero).plus(amount), count: (t?.count ?? 0) + 1 });
  };
  for (const a of amounts) {
    const c = resolveCategory(categories, a.categoryId);
    if (c?.kind === "service") continue;
    if (c?.kind === "income") add(income, c.id, a.amount);
    else if (c || a.amount.isNegative()) add(spent, c ? c.id : null, a.amount.negated());
  }
  return { spent, income };
}

/** The sum of a plan's limits: «План місяця» (BUD-16 FR 4) and the period's total of limits (FR 9) — one sum. */
export const limitsTotal = (plan: PeriodPlan, currency: string): Money =>
  plan.limits.reduce((t, l) => t.plus(l.amount), Money.zero(currency));

/**
 * FR 9, FR 12, AC5, edge case 4: what the period shows (the tally — `categoryTotals`). A category without a limit with
 * spending is in «Поза планом», which lowers «Можна витратити» too. `amounts` null — a future month: the plan only.
 */
export function periodFigures(
  plan: PeriodPlan,
  categories: ReadonlyMap<string, BudgetCategory>,
  amounts: readonly CountedAmount[] | null,
): PeriodFigures {
  const currency = plan.incomePlan.currency;
  const zero = Money.zero(currency);
  const totals = categoryTotals(categories, amounts ?? [], currency);
  const spent = new Map([...totals.spent].map(([k, t]) => [k, t.amount]));
  const income = [...totals.income.values()].reduce((t, x) => t.plus(x.amount), zero);
  const limited = new Set(plan.limits.map((l) => l.categoryId));
  const lines = plan.limits.map((l): LimitLine => {
    const s = amounts === null ? null : (spent.get(l.categoryId) ?? zero);
    return {
      categoryId: l.categoryId,
      groupId: categories.get(l.categoryId)?.groupId ?? null,
      mandatory: l.mandatory,
      limit: l.amount,
      spent: s,
      remaining: s === null ? null : l.amount.minus(s),
    };
  });
  const outsidePlan = [...spent.entries()]
    .filter(([id, s]) => (id === null || !limited.has(id)) && !s.isZero())
    .map(([categoryId, s]) => ({ categoryId, spent: s }));
  const sum = (xs: readonly Money[]) => xs.reduce((t, x) => t.plus(x), zero);
  return {
    lines,
    outsidePlan,
    totals: {
      limits: limitsTotal(plan, currency),
      spent: amounts === null ? null : sum(lines.map((l) => l.spent!)),
      outsidePlan: amounts === null ? null : sum(outsidePlan.map((o) => o.spent)),
      incomeActual: amounts === null ? null : income,
    },
  };
}

/** FR 9: a line of the card «Дохід» — an income category's plan and fact (null — a future month). */
export interface IncomeLine {
  readonly categoryId: string;
  readonly plan: Money;
  readonly actual: Money | null;
}

/**
 * FR 9, AC18: the card «Дохід» — the plan and the fact of each income category of the plan, then the income of a
 * category without a plan as a line with plan 0. A merged category's plan and income count in the one it went to
 * (BUD-01 FR 8). Order: first the categories whose fact is still below the plan, then those that reached it; inside
 * each — the order of the space's tree (the order of `categories`). A future month (`amounts` null) has no fact: the
 * plan's lines only.
 */
export function incomeLines(
  plan: PeriodPlan,
  categories: ReadonlyMap<string, BudgetCategory>,
  amounts: readonly CountedAmount[] | null,
): IncomeLine[] {
  const currency = plan.incomePlan.currency;
  const zero = Money.zero(currency);
  const planned = new Map<string, Money>();
  for (const l of plan.incomePlans ?? []) {
    const id = resolveCategory(categories, l.categoryId)?.id ?? l.categoryId;
    planned.set(id, (planned.get(id) ?? zero).plus(l.amount));
  }
  const actual = amounts === null ? null : categoryTotals(categories, amounts, currency).income;
  const ids = new Set([...planned.keys()]);
  for (const [id, t] of actual ?? []) if (!t.amount.isZero()) ids.add(id);
  const order = new Map([...categories.keys()].map((id, i) => [id, i]));
  const lines = [...ids].map((categoryId): IncomeLine => ({
    categoryId,
    plan: planned.get(categoryId) ?? zero,
    actual: actual === null ? null : (actual.get(categoryId)?.amount ?? zero),
  }));
  const reached = (l: IncomeLine) => (l.actual !== null && l.actual.compare(l.plan) >= 0 ? 1 : 0);
  return lines.sort(
    (a, b) =>
      reached(a) - reached(b) ||
      (order.get(a.categoryId) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.categoryId) ?? Number.MAX_SAFE_INTEGER),
  );
}
