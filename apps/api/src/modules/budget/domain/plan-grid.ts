import { Money } from "@willowsum/domain-kernel";
import {
  addMonths,
  convertLines,
  inBudgetCurrency,
  periodMode,
  periodOf,
  ratesMap,
  withPlanRates,
  type BudgetCategory,
  type Period,
  type PeriodPlan,
  type PlanRate,
  type PlanRates,
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
 * A line of the grid a cell belongs to: an income line — a regular income expected in the month (module recurring's
 * payment) or, null, «План доходу» (the month's income plan as typed; default — the budget's income plan of BUD-02),
 * the limit of an expense category, a goal's planned contribution, «Заощадження без цілі» (no id). «Погашення боргів» is read only
 * (FR 1): no cell.
 */
export const PLAN_LINE_KINDS = ["income", "limit", "goal", "savings"] as const;
export type PlanLineKind = (typeof PLAN_LINE_KINDS)[number];

/**
 * BUD-02@PoC FR 15: what a cell may hold — a line of the grid, or `debt` — the extra payment above the minimum that
 * «Розподіл» planned for one debt in the first period (module accounts' id of the debt). The grid shows it as that
 * month's «додатковий платіж» of the debt, read only (FR 1); it is a planned expense, not planned savings (BUD-02 FR 11).
 */
export const PLAN_CELL_KINDS = [...PLAN_LINE_KINDS, "debt"] as const;
export type PlanCellKind = (typeof PLAN_CELL_KINDS)[number];

/** A month's own value of a line; `amount` null — back to the line's default (the row stays, so its version goes on). */
export interface PlanCell {
  readonly period: Period;
  readonly kind: PlanCellKind;
  readonly lineId: string | null;
  readonly amount: Money | null;
  /** FR 3: the version the page saw; a line without a row is version 0. */
  readonly version: number;
}

export const cellKey = (kind: PlanCellKind, lineId: string | null): string => `${kind}:${lineId ?? ""}`;

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

/** A regular income expected in a month (module recurring), in the budget's currency; `amount` null — no rate. */
export interface PlanIncome {
  readonly paymentId: string;
  readonly amount: Money | null;
  /** BUD-03@PoC EC4 «приблизно»: `amount` at the nearest rate (a zero amount is exact); left out — exact. */
  readonly approximate?: boolean;
}

/**
 * The lines a month's cells may count on (FR 1, edge case 2): its expected regular incomes and the space's active
 * goals. A cell whose line the grid no longer shows — a goal closed, an income no longer expected that month, a
 * category hidden or merged — stops counting; it counts again if its line comes back (lead decision, #613).
 */
export interface PlanLines {
  readonly incomes: readonly PlanIncome[];
  readonly goalIds: ReadonlySet<string>;
}

const shownCategory = (c: BudgetCategory | undefined, kind: BudgetCategory["kind"]) =>
  c !== undefined && c.kind === kind && c.state === "active" && c.mergedInto === null;

/** The larger of two sums of one currency. */
const larger = (a: Money, b: Money): Money => (a.compare(b) < 0 ? b : a);

/**
 * FR 1 (owner decision 2026-11-19, Q3): the month's income plan — «План доходу» as typed (its cell, else the budget's
 * income plan) while the expected regular incomes (each its own cell, else the expected amount; one without a rate is
 * left out) are less: the rest is «Інші надходження»; when the regular incomes reach it or exceed it, their sum (no
 * negative row). A month without any regular income — «План доходу».
 */
export function incomeOf(base: Money, cells: readonly PlanCell[], incomes: readonly PlanIncome[]): Money {
  const own = ownIncome(cells);
  return larger(own(null) ?? base, regularIncome(own, incomes, base.currency));
}

const ownIncome = (cells: readonly PlanCell[]) => (lineId: string | null) =>
  cells.find((c) => c.kind === "income" && c.lineId === lineId && c.amount !== null)?.amount ?? null;

const regularIncome = (
  own: (lineId: string | null) => Money | null,
  incomes: readonly PlanIncome[],
  currency: string,
): Money =>
  sum(
    incomes.flatMap((i) => {
      const a = own(i.paymentId) ?? i.amount;
      return a ? [a] : [];
    }),
    currency,
  );

/**
 * BUD-03@PoC EC4 «приблизно» (#651): the month's income plan `incomePlan` (`incomeOf`) is the regular incomes' sum and
 * one of them without a cell of its own enters it at the nearest rate. A «План доходу» that happens to equal that sum
 * is marked too — the safe direction.
 */
export function incomePlanApproximate(
  incomePlan: Money,
  cells: readonly PlanCell[],
  incomes: readonly PlanIncome[],
): boolean {
  const own = ownIncome(cells);
  const nearest = incomes.some(
    (i) => own(i.paymentId) === null && i.amount !== null && i.approximate === true,
  );
  if (!nearest) return false;
  const regular = regularIncome(own, incomes, incomePlan.currency);
  return !regular.isZero() && regular.equals(incomePlan);
}

/**
 * The plan of one month with its own cells (FR 2; BUD-02 FR 11): a limit cell of a shown category sets that month's
 * limit (a category without a budget-wide limit gets one); the income plan is `incomeOf`; the active goals' cells and
 * «Заощадження без цілі» are the month's planned savings. A cell is the month's exact amount — the proportional first
 * period scales only the budget-wide plan (`base`), not what was typed for the month. `lines` null — the caller reads
 * the limits only (the trend): the income plan and planned savings stay the budget-wide ones.
 */
export function withCells(
  base: PeriodPlan,
  cells: readonly PlanCell[],
  categories: ReadonlyMap<string, BudgetCategory>,
  lines: PlanLines | null,
  /** BUD-02 FR 24: the rates a category's cell of another currency converts at; left out — the plan's own. */
  rates: PlanRates = ratesMap(base.rates),
): PeriodPlan {
  const currency = base.incomePlan.currency;
  const set = cells.filter((c) => c.amount !== null);
  const limits = new Map(base.limits.map((l) => [l.categoryId, l]));
  for (const c of set)
    if (c.kind === "limit" && c.lineId !== null && shownCategory(categories.get(c.lineId), "expense")) {
      // BUD-17 business rules (owner decision 2026-11-26): a category's cell is in its own currency.
      const [line] = convertLines([{ categoryId: c.lineId, amount: c.amount! }], currency, rates);
      limits.set(c.lineId, { ...line!, mandatory: categories.get(c.lineId)?.essential ?? false });
    }
  if (lines === null) return withPlanRates({ ...base, limits: [...limits.values()] }, rates);
  const savings = set
    .filter((c) => c.kind === "savings" || (c.kind === "goal" && lines.goalIds.has(c.lineId ?? "")))
    .map((c) => c.amount!);
  return withPlanRates(
    {
      ...base,
      incomePlan: incomeOf(base.incomePlan, set, lines.incomes),
      // BUD-02 FR 21: the categories' plans stay the budget's; a month's own «План доходу» changes the total only.
      ...(base.incomePlans ? { incomePlans: base.incomePlans } : {}),
      plannedSavings: base.plannedSavings.plus(sum(savings, base.plannedSavings.currency)),
      limits: [...limits.values()],
    },
    rates,
  );
}

/** BUD-17 business rules: a limit's default cell — in the category's own currency (BUD-02 FR 24). */
const lineAmount = (l: { amount: Money; original?: Money } | undefined): Money | null =>
  l ? (l.original ?? l.amount) : null;

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
    /**
     * «План доходу» (owner decision 2026-11-19, Q3): the month's income plan as typed — default the budget's income
     * plan of BUD-02; not a source, so not in the sum.
     */
    readonly plan: readonly GridCell[];
    /** Each regular income expected in a month of the grid; `expected` — the line counts there. */
    readonly rows: readonly {
      readonly paymentId: string;
      readonly cells: readonly (GridCell & { readonly expected: boolean })[];
    }[];
    /**
     * «Інші надходження» (Q3): «План доходу» − the regular incomes while they are less; null — they reach it (no
     * negative row), a month before the budget or without a figure.
     */
    readonly other: readonly (Money | null)[];
    /** The month's income plan: the larger of «План доходу» and the regular incomes; null — no figure. */
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
   * BUD-17 business rules (owner decision 2026-11-26): the rates (today's) the cells of categories in another currency
   * are converted at into the sums of the sections; not empty — such a sum is shown with «≈» and the hint names the rate.
   */
  readonly rates: readonly PlanRate[];
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
  /** Each month's expected regular incomes (module recurring). */
  readonly incomes: ReadonlyMap<Period, readonly PlanIncome[]>;
  /** Null — the goals are not read (a test's server). */
  readonly goals: readonly PlanGoal[] | null;
  /** Each month's debts; null for a month — its figures are unknown (no rate). */
  readonly debts: ReadonlyMap<Period, readonly PlanDebt[] | null>;
  /** BUD-02 FR 24: today's rates of the categories' own currencies; left out — none (every cell in the budget's). */
  readonly rates?: PlanRates;
}

const active = (c: BudgetCategory, kind: BudgetCategory["kind"]) => shownCategory(c, kind);

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

  const incomesOf = (m: GridMonth) => input.incomes.get(m.period) ?? [];
  const paymentIds: string[] = [];
  for (const m of months)
    for (const i of incomesOf(m)) if (!paymentIds.includes(i.paymentId)) paymentIds.push(i.paymentId);
  const incomeCell = (m: GridMonth, paymentId: string) => {
    const expected = m.inBudget && incomesOf(m).some((i) => i.paymentId === paymentId);
    if (!expected) return { ...cellOf(m, "income", paymentId, null), amount: null, own: false, expected };
    const fallback = incomesOf(m).find((i) => i.paymentId === paymentId)?.amount ?? null;
    return { ...cellOf(m, "income", paymentId, fallback), expected };
  };
  const incomePlan = months.map((m) => cellOf(m, "income", null, base(m)?.incomePlan ?? null));
  const incomeRows = paymentIds.map((paymentId) => ({
    paymentId,
    cells: months.map((m) => incomeCell(m, paymentId)),
  }));
  // An expected source without a rate and no own value leaves the month without an income total.
  const incomeKnown = (i: number) =>
    incomeRows.every((r) => !r.cells[i]!.expected || r.cells[i]!.amount !== null);
  const regularTotals = months.map((_, i) =>
    incomeKnown(i)
      ? total(
          incomeRows.map((r) => r.cells),
          i,
        )
      : null,
  );
  // A Map keeps the order of insertion: the groups come in the tree's order.
  const groups = new Map<string, { categoryId: string; cells: GridCell[] }[]>();
  for (const c of input.categories.filter((c) => active(c, "expense"))) {
    if (!groups.has(c.groupId)) groups.set(c.groupId, []);
    groups.get(c.groupId)!.push({
      categoryId: c.id,
      cells: months.map((m) =>
        cellOf(m, "limit", c.id, lineAmount(base(m)?.limits.find((l) => l.categoryId === c.id))),
      ),
    });
  }
  // BUD-17 business rules (owner decision 2026-11-26): a category's cell is in its own currency; the section's sum is
  // in the budget's, each cell at today's rate — a cell without a rate leaves the month without a sum.
  const rates = input.rates ?? new Map<string, PlanRate>();
  const used = new Map<string, PlanRate>();
  const expenseRows = [...groups.values()].flat().map((r) =>
    r.cells.map((c) => {
      if (!c.amount || c.amount.currency === currency) return { amount: c.amount, unknown: false };
      const converted = inBudgetCurrency(c.amount, currency, rates);
      if (converted) used.set(c.amount.currency, rates.get(c.amount.currency)!);
      return { amount: converted, unknown: converted === null };
    }),
  );
  const expensesKnown = (i: number) => expenseRows.every((r) => !r[i]!.unknown);

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

  const incomeTotals = months.map((_, i) => {
    const [typed, regular] = [incomePlan[i]!.amount, regularTotals[i]];
    return typed && regular ? larger(typed, regular) : null;
  });
  const otherIncome = months.map((_, i) => {
    const [typed, regular] = [incomePlan[i]!.amount, regularTotals[i]];
    return typed && regular && regular.compare(typed) < 0 ? typed.minus(regular) : null;
  });
  const expenseTotals = months.map((_, i) => (expensesKnown(i) ? total(expenseRows, i) : null));
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
    income: { plan: incomePlan, rows: incomeRows, other: otherIncome, totals: incomeTotals },
    expenses: {
      groups: [...groups].map(([groupId, categories]) => ({ groupId, categories })),
      totals: expenseTotals,
    },
    goals: { rows: goalRows, savings, totals: goalTotals },
    debts: { rows: debtRows, totals: debtTotals },
    rates: [...used.values()].sort((a, b) => (a.currency < b.currency ? -1 : 1)),
    unallocated,
  };
}
