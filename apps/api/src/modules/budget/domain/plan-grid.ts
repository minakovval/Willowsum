import { Money } from "@willowsum/domain-kernel";
import {
  addMonths,
  periodMode,
  periodOf,
  type BudgetCategory,
  type Period,
  type PeriodPlan,
} from "./budget.ts";

/**
 * «Бюджет → План» (BUD-17@PoC a; wave 2 row 35): the grid «рядки × 12 місяців» — the current month and the 11 next
 * (FR 1, FR 6) — with the sections «Надходження», «Витрати», «Цілі й заощадження», «Погашення боргів» and the row
 * «Не розподілено» / «Дефіцит». A cell is a month's own value of one line (FR 2): it acts on that month only and wins
 * over the budget-wide value of BUD-02 (the income plan, the limit). Exact Decimal sums in the budget's currency; no
 * I/O.
 */

/** The months of the grid (FR 1). */
export const PLAN_GRID_MONTHS = 12;

/**
 * A line of the grid a cell belongs to: an income source (an income category, or null — «Інші надходження», the
 * budget's income plan of BUD-02), the limit of an expense category, a goal's planned contribution, «Заощадження без
 * цілі» (no id). «Погашення боргів» is read only (FR 1): no cell.
 */
export const PLAN_LINE_KINDS = ["income", "limit", "goal", "savings"] as const;
export type PlanLineKind = (typeof PLAN_LINE_KINDS)[number];

/** A month's own value of a line; `amount` null — back to the line's default (the row stays, so its version goes on). */
export interface PlanCell {
  readonly period: Period;
  readonly kind: PlanLineKind;
  readonly lineId: string | null;
  readonly amount: Money | null;
  /** FR 3: the version the page saw; a line without a row is version 0. */
  readonly version: number;
}

export const cellKey = (kind: PlanLineKind, lineId: string | null): string => `${kind}:${lineId ?? ""}`;

/** FR 1, FR 6: the grid's months — the current one and the 11 next. */
export function gridMonths(today: string): Period[] {
  const first = periodOf(today);
  return Array.from({ length: PLAN_GRID_MONTHS }, (_, i) => addMonths(first, i));
}

/**
 * FR 2, business rules: which month a cell may change — the grid's own months only; a past month is read only
 * («Минулий місяць змінити не можна»).
 */
export function cellPeriodIssue(period: Period, today: string): "past" | "too_far" | null {
  if (periodMode(period, today) === "past") return "past";
  return period > addMonths(periodOf(today), PLAN_GRID_MONTHS - 1) ? "too_far" : null;
}

const sum = (xs: readonly Money[], currency: string): Money =>
  xs.reduce((t, x) => t.plus(x), Money.zero(currency));

/**
 * The plan of one month with its own cells (FR 2; BUD-02 FR 11): a limit cell sets that month's limit (a category
 * without a budget-wide limit gets one); «Інші надходження» replaces the income plan and each source's cell adds to it;
 * the goals' cells and «Заощадження без цілі» are the month's planned savings. A cell is the month's exact amount — the
 * proportional first period scales only the budget-wide plan (`base`), not what was typed for the month.
 */
export function withCells(
  base: PeriodPlan,
  cells: readonly PlanCell[],
  categories: ReadonlyMap<string, BudgetCategory>,
  currency: string,
): PeriodPlan {
  const set = cells.filter((c) => c.amount !== null);
  if (set.length === 0) return base;
  const amount = (c: PlanCell) => c.amount!;
  const other = set.find((c) => c.kind === "income" && c.lineId === null);
  const sources = set.filter((c) => c.kind === "income" && c.lineId !== null).map(amount);
  const limits = new Map(base.limits.map((l) => [l.categoryId, l]));
  for (const c of set)
    if (c.kind === "limit" && c.lineId !== null)
      limits.set(c.lineId, {
        categoryId: c.lineId,
        amount: amount(c),
        mandatory: categories.get(c.lineId)?.essential ?? false,
      });
  const savings = set.filter((c) => c.kind === "goal" || c.kind === "savings").map(amount);
  return {
    incomePlan: (other ? amount(other) : base.incomePlan).plus(sum(sources, currency)),
    plannedSavings: base.plannedSavings.plus(sum(savings, currency)),
    limits: [...limits.values()],
  };
}

/** A goal as the grid plans it (module goals, in the budget's currency). */
export interface PlanGoal {
  readonly goalId: string;
  /** BUD-05 FR 5: the required monthly contribution, today; null — no date, past it, or no rate. */
  readonly required: Money | null;
  /** The month of the goal's date: no planned contribution after it; null — nothing planned (no date or past it). */
  readonly lastPeriod: Period | null;
}

/** «Погашення боргів» of one month (FR 1): each debt's minimum payment and the extra payment of its saved plan. */
export interface PlanDebt {
  readonly accountId: string;
  readonly minimum: Money | null;
  readonly extra: Money | null;
}

export interface GridCell {
  /** The month's value; null — empty (no limit, no source income, no contribution). */
  readonly amount: Money | null;
  /** FR 2: the month has its own value (a cell), not the line's default. */
  readonly own: boolean;
  readonly version: number;
}

export interface GridMonth {
  readonly period: Period;
  readonly mode: "current" | "future";
  /** Before the budget's first period: nothing is planned, no cell is editable. */
  readonly inBudget: boolean;
}

export interface PlanGrid {
  readonly months: readonly GridMonth[];
  readonly income: {
    readonly rows: readonly { readonly categoryId: string | null; readonly cells: readonly GridCell[] }[];
    readonly totals: readonly (Money | null)[];
  };
  readonly expenses: {
    readonly groups: readonly {
      readonly groupId: string;
      readonly categories: readonly { readonly categoryId: string; readonly cells: readonly GridCell[] }[];
    }[];
    readonly totals: readonly (Money | null)[];
  };
  readonly goals: {
    readonly rows: readonly {
      readonly goalId: string;
      readonly cells: readonly (GridCell & { readonly required: Money | null })[];
    }[];
    readonly savings: readonly GridCell[];
    /** Null — the goals could not be read in the budget's currency (no rate). */
    readonly totals: readonly (Money | null)[];
  };
  readonly debts: {
    readonly rows: readonly {
      readonly accountId: string;
      readonly cells: readonly { readonly minimum: Money | null; readonly extra: Money | null }[];
    }[];
    readonly totals: readonly (Money | null)[];
  };
  /**
   * FR 1, AC6: «Не розподілено» = надходження − витрати − цілі й заощадження − погашення боргів; negative —
   * «Дефіцит N €» (`kind` deficit, `amount` its absolute value). Null — a section without a figure.
   */
  readonly unallocated: readonly ({
    readonly kind: "unallocated" | "deficit";
    readonly amount: Money;
  } | null)[];
}

export interface GridInput {
  readonly today: string;
  readonly currency: string;
  readonly firstPeriod: Period;
  /** The tree in its order (module categories). */
  readonly categories: readonly BudgetCategory[];
  /** The budget-wide plan of each month (BUD-02: the income plan and limits, a proportional first period scaled). */
  readonly base: ReadonlyMap<Period, PeriodPlan>;
  readonly cells: readonly PlanCell[];
  /** Null — the goals are not read (a test's server). */
  readonly goals: readonly PlanGoal[] | null;
  /** Each month's debts; null for a month — its figures are unknown (no rate). */
  readonly debts: ReadonlyMap<Period, readonly PlanDebt[] | null>;
}

const active = (c: BudgetCategory, kind: BudgetCategory["kind"]) =>
  c.kind === kind && c.state === "active" && c.mergedInto === null;

/** The grid (FR 1): rows of active categories (edge case 2: a hidden or merged one is gone), active goals and debts. */
export function planGrid(input: GridInput): PlanGrid {
  const { currency } = input;
  const months: GridMonth[] = gridMonths(input.today).map((period) => ({
    period,
    mode: period === periodOf(input.today) ? "current" : "future",
    inBudget: period >= input.firstPeriod,
  }));
  const cells = new Map<string, PlanCell>();
  for (const c of input.cells) cells.set(`${c.period}/${cellKey(c.kind, c.lineId)}`, c);
  const cellOf = (
    m: GridMonth,
    kind: PlanLineKind,
    lineId: string | null,
    fallback: Money | null,
  ): GridCell => {
    const own = cells.get(`${m.period}/${cellKey(kind, lineId)}`);
    if (!m.inBudget) return { amount: null, own: false, version: own?.version ?? 0 };
    if (own?.amount) return { amount: own.amount, own: true, version: own.version };
    return { amount: fallback, own: false, version: own?.version ?? 0 };
  };
  const base = (m: GridMonth) => input.base.get(m.period);
  const total = (rows: readonly (readonly { amount: Money | null }[])[], i: number): Money | null =>
    months[i]!.inBudget
      ? sum(
          rows.flatMap((r) => (r[i]!.amount ? [r[i]!.amount!] : [])),
          currency,
        )
      : null;

  const incomeRows = [
    { categoryId: null, cells: months.map((m) => cellOf(m, "income", null, base(m)?.incomePlan ?? null)) },
    ...input.categories
      .filter((c) => active(c, "income"))
      .map((c) => ({ categoryId: c.id, cells: months.map((m) => cellOf(m, "income", c.id, null)) })),
  ];
  // A Map keeps the order of insertion: the groups come in the tree's order.
  const groups = new Map<string, { categoryId: string; cells: GridCell[] }[]>();
  for (const c of input.categories.filter((c) => active(c, "expense"))) {
    if (!groups.has(c.groupId)) groups.set(c.groupId, []);
    groups.get(c.groupId)!.push({
      categoryId: c.id,
      cells: months.map((m) =>
        cellOf(m, "limit", c.id, base(m)?.limits.find((l) => l.categoryId === c.id)?.amount ?? null),
      ),
    });
  }
  const expenseRows = [...groups.values()].flat().map((r) => r.cells);

  const goalRows = (input.goals ?? []).map((g) => ({
    goalId: g.goalId,
    cells: months.map((m) => {
      const planned = g.required && g.lastPeriod !== null && m.period <= g.lastPeriod ? g.required : null;
      return { ...cellOf(m, "goal", g.goalId, planned), required: g.required };
    }),
  }));
  const savings = months.map((m) => cellOf(m, "savings", null, null));
  // A goal without a figure (no rate) and no own value leaves the section without a total: no sum beats a wrong one.
  const goalsKnown = (i: number) =>
    input.goals !== null &&
    goalRows.every((r, j) => {
      const g = input.goals![j]!;
      return (
        r.cells[i]!.own || g.required !== null || g.lastPeriod === null || months[i]!.period > g.lastPeriod
      );
    });

  const debtIds: string[] = [];
  for (const m of months)
    for (const d of input.debts.get(m.period) ?? [])
      if (!debtIds.includes(d.accountId)) debtIds.push(d.accountId);
  const debtRows = debtIds.map((accountId) => ({
    accountId,
    cells: months.map((m) => {
      const d = m.inBudget ? input.debts.get(m.period)?.find((x) => x.accountId === accountId) : undefined;
      return { minimum: d?.minimum ?? null, extra: d?.extra ?? null };
    }),
  }));
  const debtTotal = (i: number): Money | null => {
    const m = months[i]!;
    if (!m.inBudget) return null;
    const ds = input.debts.get(m.period);
    return ds
      ? sum(
          ds.flatMap((d) => [d.minimum, d.extra].filter((x): x is Money => x !== null)),
          currency,
        )
      : null;
  };

  const incomeTotals = months.map((_, i) =>
    total(
      incomeRows.map((r) => r.cells),
      i,
    ),
  );
  const expenseTotals = months.map((_, i) => total(expenseRows, i));
  const goalTotals = months.map((_, i) =>
    goalsKnown(i) ? total([...goalRows.map((r) => r.cells), savings], i) : null,
  );
  const debtTotals = months.map((_, i) => debtTotal(i));
  const unallocated = months.map((_, i) => {
    const [inc, exp, goals, debts] = [incomeTotals[i], expenseTotals[i], goalTotals[i], debtTotals[i]];
    if (!inc || !exp || !goals || !debts) return null;
    const rest = inc.minus(exp).minus(goals).minus(debts);
    return rest.isNegative()
      ? { kind: "deficit" as const, amount: rest.negated() }
      : { kind: "unallocated" as const, amount: rest };
  });
  return {
    months,
    income: { rows: incomeRows, totals: incomeTotals },
    expenses: {
      groups: [...groups].map(([groupId, categories]) => ({ groupId, categories })),
      totals: expenseTotals,
    },
    goals: { rows: goalRows, savings, totals: goalTotals },
    debts: { rows: debtRows, totals: debtTotals },
    unallocated,
  };
}
