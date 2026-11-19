import { Decimal, Money } from "@willowsum/domain-kernel";
import {
  addMonths,
  isPeriod,
  periodDays,
  periodOf,
  type BudgetCategory,
  type BudgetIssue,
  type CategoryTotals,
  type Period,
  type PeriodPlan,
  type Tally,
} from "./budget.ts";
import { monthPlan } from "./trend.ts";

/**
 * «Порівняння» (BUD-06@PoC a; wave 2 row 36): the windows of a period and of its base, one change against a base or a
 * plan, the table of categories and «Рік: план і факт». The plan of a month is BUD-16's `monthPlan` (the sum of its
 * limits; a finished month — its snapshot's). Facts only, no text (business rules). Pure; no I/O.
 */

/** FR 1: «Місяць», «Квартал», «З початку року», «Рік» («Власний» — from MVP, owner 2026-11-19, #606). */
export const COMPARE_TYPES = ["month", "quarter", "ytd", "year"] as const;
export type CompareType = (typeof COMPARE_TYPES)[number];

/** FR 1: «Попередній період», «Той самий період минулого року» («Минулий рік»), «Середнє за 3 / 6 / 12 міс.». */
export const COMPARE_BASES = ["previous", "last-year", "avg3", "avg6", "avg12"] as const;
export type CompareBase = (typeof COMPARE_BASES)[number];

/**
 * FR 1: the bases of each type — «Рік» only «Минулий рік», «З початку року» only the same period last year.
 */
export const BASES_BY_TYPE: Readonly<Record<CompareType, readonly CompareBase[]>> = {
  month: COMPARE_BASES,
  quarter: COMPARE_BASES,
  ytd: ["last-year"],
  year: ["last-year"],
};
export const defaultBase = (type: CompareType): CompareBase => BASES_BY_TYPE[type][0]!;

/** Dates from the first to the last day, YYYY-MM-DD, both inclusive. */
export interface DateWindow {
  readonly from: string;
  readonly to: string;
}

export interface CompareSelection {
  readonly type: CompareType;
  /** What the table counts: the period, up to today while it lasts (FR 2); a past year's ytd — to the same date. */
  readonly window: DateWindow;
  /** The whole period. */
  readonly period: DateWindow;
  /** The calendar months the window touches, oldest first: the months of its plan. */
  readonly months: readonly Period[];
  /** Months in one period of the type: 1, 3 or 12. */
  readonly length: number;
  /** Today is in the period: the base is cut at the same date (FR 2). False for a past year's ytd, cut all the same. */
  readonly inProgress: boolean;
  /** The period has ended: «Найбільші зміни» opens «Підсумок <місяць>» (FR 6). */
  readonly finished: boolean;
  /** FR 11: the calendar year «Рік: план і факт» opens on — the one the period (its end) belongs to. */
  readonly year: string;
}

/** The first year a period may name: 0000 is no year of the database's calendar (security review of #605, N1). */
export const COMPARE_MIN_YEAR = "1900";
export const isCompareYear = (year: string): boolean => /^\d{4}$/.test(year) && year >= COMPARE_MIN_YEAR;

const lastDay = (period: Period) => periodDays(period).to;

/** FR 3: the same day `months` months away; days 29–31 go to the last day of a shorter month. */
export function shiftDate(date: string, months: number): string {
  const to = lastDay(addMonths(periodOf(date), months));
  const day = `${to.slice(0, 8)}${date.slice(8)}`;
  return day < to ? day : to;
}

function monthsOf(window: DateWindow): Period[] {
  const out: Period[] = [];
  for (let p = periodOf(window.from); p <= periodOf(window.to); p = addMonths(p, 1)) out.push(p);
  return out;
}

/** FR 1, FR 2: the period chosen by type, cut at today while it lasts; a period not begun yet is an issue. */
export function compareSelection(
  input: {
    readonly type: CompareType;
    readonly period?: string | undefined;
  },
  today: string,
): CompareSelection | BudgetIssue {
  const p = input.period ?? "";
  let period: DateWindow;
  let length: number;
  switch (input.type) {
    case "month":
      if (!isPeriod(p) || !isCompareYear(p.slice(0, 4))) return { field: "period", issue: "invalid" };
      period = periodDays(p);
      length = 1;
      break;
    case "quarter": {
      const m = /^(\d{4})-Q([1-4])$/.exec(p);
      if (!m || !isCompareYear(m[1]!)) return { field: "period", issue: "invalid" };
      const first = `${m[1]}-${String((+m[2]! - 1) * 3 + 1).padStart(2, "0")}`;
      period = { from: `${first}-01`, to: lastDay(addMonths(first, 2)) };
      length = 3;
      break;
    }
    case "year":
    case "ytd": {
      const year = input.period ?? today.slice(0, 4);
      if (!isCompareYear(year)) return { field: "period", issue: "invalid" };
      period = { from: `${year}-01-01`, to: `${year}-12-31` };
      length = 12;
      break;
    }
  }
  if (period.from > today) return { field: "period", issue: "future" };
  const inProgress = period.to > today;
  // AC10: «З початку року» — January to today; a past year's (owner 2026-11-19, #609; CMP-72 «‹») — January to the
  // same date of that year, 29 February to the 28th of a common year (FR 3).
  const end =
    input.type === "ytd" ? shiftDate(today, (+period.from.slice(0, 4) - +today.slice(0, 4)) * 12) : today;
  const window = { from: period.from, to: period.to > end ? end : period.to };
  return {
    type: input.type,
    window,
    period,
    months: monthsOf(window),
    length,
    inProgress,
    finished: period.to < today,
    year: period.to.slice(0, 4),
  };
}

/**
 * FR 2, FR 3: «Попередній період» (the period before, of the same length) or «Той самий період минулого року» / «Минулий
 * рік» — on the same date while the period lasts (days 1–12 against days 1–12), whole when it has ended or with
 * «Повний попередній період» (`full`).
 */
export function baseWindow(
  selection: CompareSelection,
  base: "previous" | "last-year",
  full: boolean,
): DateWindow {
  const { window, period, length } = selection;
  const k = base === "previous" ? -length : -12;
  const whole = full || window.to === period.to;
  return {
    from: shiftDate(period.from, k),
    to: whole ? lastDay(addMonths(periodOf(period.to), k)) : shiftDate(window.to, k),
  };
}

/**
 * FR 4, AC5: «Середнє за N міс.» — over the finished periods of the type in the N months before the period (a quarter:
 * N ÷ 3 quarters), only those wholly after the start of the space's history (`historyStart`, the first transaction of
 * the budget's accounts) and with data — at least one counted amount in one of its months (`withData`; null — not read
 * yet: every period after the start, the dates to read). With fewer, the average is over the ones there are («за N
 * міс.» — `months`); `included` — the months whose amounts it sums.
 */
export function averageBase(
  selection: CompareSelection,
  months: 3 | 6 | 12,
  historyStart: string | null,
  withData: ReadonlySet<Period> | null,
): {
  readonly window: DateWindow | null;
  readonly periods: number;
  readonly months: number;
  readonly included: readonly Period[];
} {
  const length = selection.length === 3 ? 3 : 1;
  const first = periodOf(selection.period.from);
  const included: Period[] = [];
  let oldest: Period | null = null;
  let periods = 0;
  for (let i = 1; i <= months / length && historyStart !== null; i++) {
    const start = addMonths(first, -i * length);
    if (`${start}-01` < historyStart) break;
    const its = Array.from({ length }, (_, k) => addMonths(start, k));
    if (withData !== null && !its.some((m) => withData.has(m))) continue;
    periods += 1;
    oldest = start;
    included.unshift(...its);
  }
  if (oldest === null) return { window: null, periods: 0, months: 0, included: [] };
  return {
    window: { from: `${oldest}-01`, to: lastDay(addMonths(first, -1)) },
    periods,
    months: periods * length,
    included,
  };
}

/**
 * FR 1: one change against a base or a plan — the amount (signed), the percent of the value compared with (one
 * decimal; none against 0, AC7), the arrow and the colour: «краще» or «гірше», not the direction — less spending and
 * more income are `gain`, the opposite `loss`; up to 10 % of that value inclusive the light step (`-soft`); «без змін»
 * — under 1 % and under 1 unit of the currency — `none`.
 */
export interface Change {
  readonly amount: Money;
  readonly percent: string | null;
  readonly direction: "up" | "down" | "none";
  readonly tone: "gain" | "gain-soft" | "loss" | "loss-soft" | "none";
}

export function change(current: Money, against: Money, kind: "expense" | "income"): Change {
  const amount = current.minus(against);
  const diff = amount.amount.abs();
  const base = against.amount.abs();
  const share = base.isZero() ? null : diff.dividedBy(base);
  const unchanged = amount.isZero() || (share !== null && diff.lessThan(1) && share.lessThan("0.01"));
  const better = kind === "expense" ? amount.isNegative() : !amount.isNegative();
  const strong = share === null || share.greaterThan("0.1");
  return {
    amount,
    percent: share === null ? null : share.times(100).toFixed(1, Decimal.ROUND_HALF_EVEN),
    direction: unchanged ? "none" : amount.isNegative() ? "down" : "up",
    tone: unchanged ? "none" : `${better ? "gain" : "loss"}${strong ? "" : "-soft"}`,
  };
}

/** One row of the table: now, the plan and «± до плану», the base and the difference with it, the transactions. */
export interface CompareRow {
  /** Null — «Без категорії» (or a total). */
  readonly categoryId: string | null;
  readonly current: Money;
  /** The limits of the window's months by their snapshots; null — «Поза планом» («–») or a month before the budget. */
  readonly plan: Money | null;
  readonly planDifference: Change | null;
  /** Null — the base is not available (FR 5). */
  readonly base: Money | null;
  readonly difference: Change | null;
  /** FR 6: «на 6 транзакцій більше» — an average's count is rounded to whole transactions. */
  readonly transactions: { readonly current: number; readonly base: number | null };
}

export interface CompareTable {
  readonly expenses: { readonly total: CompareRow; readonly categories: readonly CompareRow[] };
  readonly income: { readonly total: CompareRow; readonly categories: readonly CompareRow[] };
  /** FR 6: the three largest changes of spending, as the table sorts them. */
  readonly largest: readonly {
    readonly categoryId: string | null;
    readonly difference: Money;
    readonly transactions: { readonly current: number; readonly base: number | null };
  }[];
}

const sumOf = (xs: readonly (Money | null)[], currency: string): Money | null =>
  xs.reduce<Money | null>((t, x) => (x === null ? t : (t ?? Money.zero(currency)).plus(x)), null);

/** An average: the sum ÷ the periods, exact to the money type's 18 decimals (never rounded to cents). */
const averaged = (t: Tally | undefined, divisor: number, currency: string): Tally => ({
  amount: Money.of(
    (t?.amount ?? Money.zero(currency)).amount
      .dividedBy(String(divisor))
      .toDecimalPlaces(18, Decimal.ROUND_HALF_EVEN),
    currency,
  ),
  count: Math.round((t?.count ?? 0) / divisor),
});

function row(
  categoryId: string | null,
  kind: "expense" | "income",
  current: Tally | undefined,
  base: Tally | null,
  plan: Money | null,
  currency: string,
  /** The fact «± до плану» compares with (the budget period's); the base columns take `current`. */
  planFact: Tally | undefined,
): CompareRow {
  const now = current?.amount ?? Money.zero(currency);
  return {
    categoryId,
    current: now,
    plan,
    planDifference: plan === null ? null : change(planFact?.amount ?? Money.zero(currency), plan, kind),
    base: base?.amount ?? null,
    difference: base === null ? null : change(now, base.amount, kind),
    transactions: { current: current?.count ?? 0, base: base?.count ?? null },
  };
}

const total = (tallies: Iterable<Tally>, currency: string): Tally => {
  let amount = Money.zero(currency);
  let count = 0;
  for (const t of tallies) {
    amount = amount.plus(t.amount);
    count += t.count;
  }
  return { amount, count };
};

/** FR 6: by the absolute difference, then by the amount now. */
function sorted(rows: CompareRow[]): CompareRow[] {
  const key = (r: CompareRow) => r.difference?.amount.amount.abs() ?? r.current.amount.abs();
  return rows.sort(
    (a, b) =>
      key(b).comparedTo(key(a)) ||
      b.current.amount.abs().comparedTo(a.current.amount.abs()) ||
      String(a.categoryId).localeCompare(String(b.categoryId)),
  );
}

/**
 * FR 1, FR 4, FR 6, AC2, AC9: the table of «Порівняння». `base` — the base's tally and how many periods it holds (1, or
 * N for an average); null — not available. `plans` — the plans of the window's months (null — before the budget); null
 * — no plan column. Spending by expense category with «Без категорії», income by income category.
 */
export function compareTable(input: {
  readonly currency: string;
  readonly current: CategoryTotals;
  readonly base: { readonly sums: CategoryTotals; readonly divisor: number } | null;
  readonly plans: readonly (PeriodPlan | null)[] | null;
  /**
   * The fact the plan columns compare with: the budget periods' (BUD-02 FR 14 — a proportional first period from its
   * first day, as «Бюджет» and «Тренд» count it); omitted — `current`.
   */
  readonly planCurrent?: CategoryTotals;
}): CompareTable {
  const { currency, current, base, plans } = input;
  const planCurrent = input.planCurrent ?? current;
  const baseOf = <K>(pick: (s: CategoryTotals) => ReadonlyMap<K, Tally>, key: K) =>
    base === null ? null : averaged(pick(base.sums).get(key), base.divisor, currency);
  const planOf = (categoryId?: string) =>
    plans === null
      ? null
      : sumOf(
          plans.map((p) => monthPlan(p, currency, categoryId)),
          currency,
        );
  const limited = new Set((plans ?? []).flatMap((p) => p?.limits.map((l) => l.categoryId) ?? []));
  const expenseIds = new Set<string | null>([
    ...current.spent.keys(),
    ...planCurrent.spent.keys(),
    ...(base?.sums.spent.keys() ?? []),
    ...limited,
  ]);
  const expenses = sorted(
    [...expenseIds].map((id) =>
      row(
        id,
        "expense",
        current.spent.get(id),
        baseOf((s) => s.spent, id),
        id === null ? null : planOf(id),
        currency,
        planCurrent.spent.get(id),
      ),
    ),
  );
  const incomeIds = new Set([...current.income.keys(), ...(base?.sums.income.keys() ?? [])]);
  const income = sorted(
    [...incomeIds].map((id) =>
      row(
        id,
        "income",
        current.income.get(id),
        baseOf((s) => s.income, id),
        null,
        currency,
        undefined,
      ),
    ),
  );
  const totalBase = (pick: (s: CategoryTotals) => ReadonlyMap<unknown, Tally>) =>
    base === null ? null : averaged(total(pick(base.sums).values(), currency), base.divisor, currency);
  const incomePlan =
    plans === null
      ? null
      : sumOf(
          plans.map((p) => p?.incomePlan ?? null),
          currency,
        );
  return {
    expenses: {
      total: row(
        null,
        "expense",
        total(current.spent.values(), currency),
        totalBase((s) => s.spent),
        planOf(),
        currency,
        total(planCurrent.spent.values(), currency),
      ),
      categories: expenses,
    },
    income: {
      total: row(
        null,
        "income",
        total(current.income.values(), currency),
        totalBase((s) => s.income),
        incomePlan,
        currency,
        total(planCurrent.income.values(), currency),
      ),
      categories: income,
    },
    largest: expenses
      .filter((r) => r.difference !== null && r.difference.direction !== "none")
      .slice(0, 3)
      .map((r) => ({
        categoryId: r.categoryId,
        difference: r.difference!.amount,
        transactions: r.transactions,
      })),
  };
}

/** FR 11: one month of «Рік: план і факт» — the fact (null — a future month: the plan only, grey) and «± до плану». */
export interface YearCell {
  readonly fact: Money | null;
  readonly plan: Money | null;
  readonly difference: Change | null;
}

/** FR 11: a row — 12 cells, «Разом за рік», «План», «Різниця» over the finished months (lead decision C0c). */
export interface YearRow {
  readonly cells: readonly YearCell[];
  readonly total: Money;
  readonly plan: Money | null;
  readonly difference: Change | null;
}

export interface YearTable {
  readonly income: YearRow;
  /** Category rows by group, in the order of the category tree; «Без категорії» — group null, last. */
  readonly groups: readonly (YearRow & {
    readonly groupId: string | null;
    readonly categories: readonly (YearRow & { readonly categoryId: string | null })[];
  })[];
  /** «Усього витрат». */
  readonly expenses: YearRow;
}

function yearRow(
  months: readonly { readonly mode: "past" | "current" | "future" }[],
  facts: readonly (Money | null)[],
  plans: readonly (Money | null)[],
  kind: "expense" | "income",
  currency: string,
): YearRow {
  const cells = months.map((m, i) => {
    const fact = m.mode === "future" ? null : facts[i]!;
    const plan = plans[i]!;
    return { fact, plan, difference: fact !== null && plan !== null ? change(fact, plan, kind) : null };
  });
  const finished = months.map((m, i) => (m.mode === "past" ? i : -1)).filter((i) => i >= 0);
  const sum =
    sumOf(
      finished.map((i) => facts[i]!),
      currency,
    ) ?? Money.zero(currency);
  const plan = sumOf(
    finished.map((i) => plans[i]!),
    currency,
  );
  return { cells, total: sum, plan, difference: plan === null ? null : change(sum, plan, kind) };
}

/**
 * FR 11, AC11: «Рік: план і факт» — the 12 months of a calendar year: categories × months, the fact and «± до плану»
 * (the plan of a month — `monthPlan`, FR 7), group rows, «Усього витрат» and «Дохід» (fact and income plan); a future
 * month shows the plan only. `sums` null — a future month. A category without fact or plan in the year is no row.
 */
export function yearTable(input: {
  readonly currency: string;
  readonly months: readonly {
    readonly mode: "past" | "current" | "future";
    readonly plan: PeriodPlan | null;
    readonly sums: CategoryTotals | null;
  }[];
  /** The space's categories in the order of the tree. */
  readonly categories: readonly BudgetCategory[];
}): YearTable {
  const { currency, months } = input;
  const zero = Money.zero(currency);
  const fact = (pick: (s: CategoryTotals) => Money) =>
    months.map((m) => (m.sums === null ? null : pick(m.sums)));
  const ids = new Set<string | null>();
  for (const m of months) {
    for (const [id, t] of m.sums?.spent ?? []) if (!t.amount.isZero()) ids.add(id);
    for (const l of m.plan?.limits ?? []) ids.add(l.categoryId);
  }
  const order = new Map(input.categories.map((c, i) => [c.id, i]));
  const group = new Map(input.categories.map((c) => [c.id, c.groupId]));
  const rows = [...ids]
    .sort((a, b) => (a === null ? 1e9 : (order.get(a) ?? 1e8)) - (b === null ? 1e9 : (order.get(b) ?? 1e8)))
    .map((id) => ({
      categoryId: id,
      groupId: id === null ? null : (group.get(id) ?? null),
      ...yearRow(
        months,
        fact((s) => s.spent.get(id)?.amount ?? zero),
        months.map((m) => (id === null ? null : monthPlan(m.plan, currency, id))),
        "expense",
        currency,
      ),
    }));
  const groupIds = [...new Set(rows.map((r) => r.groupId))];
  const groups = groupIds.map((groupId) => {
    const members = rows.filter((r) => r.groupId === groupId);
    const column = (pick: (c: YearCell) => Money | null) =>
      months.map((_, i) =>
        sumOf(
          members.map((r) => pick(r.cells[i]!)),
          currency,
        ),
      );
    const facts = months.map((m, i) => (m.sums === null ? null : (column((c) => c.fact)[i] ?? zero)));
    return {
      groupId,
      categories: members.map((r) => ({
        categoryId: r.categoryId,
        cells: r.cells,
        total: r.total,
        plan: r.plan,
        difference: r.difference,
      })),
      ...yearRow(
        months,
        facts,
        column((c) => c.plan),
        "expense",
        currency,
      ),
    };
  });
  return {
    income: yearRow(
      months,
      fact((s) => total(s.income.values(), currency).amount),
      months.map((m) => m.plan?.incomePlan ?? null),
      "income",
      currency,
    ),
    groups,
    expenses: yearRow(
      months,
      fact((s) => total(s.spent.values(), currency).amount),
      months.map((m) => monthPlan(m.plan, currency)),
      "expense",
      currency,
    ),
  };
}
