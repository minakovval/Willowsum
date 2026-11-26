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
  type IncomePlanLine,
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
 * A line of the grid a cell belongs to: an income category of the budget's plan (FR 1; owner decision 2026-11-21, 2 б —
 * module categories' id), the limit of an expense category, a goal's planned contribution, «Заощадження без цілі» (no
 * id). «Погашення боргів» is read only (FR 1): no cell. A stored `income` cell of another line — a regular income's
 * (module recurring's payment) or the nil id of the former «План доходу» — is kept and no longer counts (row 231),
 * except the nil one of a budget without income categories (`incomeOf`).
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

/**
 * The lines a month's cells may count on besides the categories (FR 1, edge case 2): the space's active goals. A cell
 * whose line the grid no longer shows — a goal closed, a category hidden or merged, an income category no longer in the
 * budget's plan — stops counting; it counts again if its line comes back (lead decision, #613).
 */
export interface PlanLines {
  readonly goalIds: ReadonlySet<string>;
}

const shownCategory = (c: BudgetCategory | undefined, kind: BudgetCategory["kind"]) =>
  c !== undefined && c.kind === kind && c.state === "active" && c.mergedInto === null;

const ownCell = (cells: readonly PlanCell[], kind: PlanCellKind, lineId: string | null) =>
  cells.find((c) => c.kind === kind && c.lineId === lineId && c.amount !== null)?.amount ?? null;

/**
 * Row 231 (lead decision 2026-11-26): a month's «План доходу» typed before the rows by category (an income cell on the
 * nil line) is laid out on those rows when read, until the month has an own value of a shown income category — then
 * `setPlanCell` stores the laid-out values first (`legacyIncome` is null from there on). The shown categories with a
 * plan in the budget's currency share the typed amount less the plans that count without a row (hidden or merged
 * categories in the budget's currency): largest plan first (then by id), each takes its plan while the amount lasts,
 * the first one also what is left — exactly, no rounding. A category in another currency keeps its own plan, on top.
 * No such category, or the plans without a row above the typed amount: the typed amount stays the month's income plan
 * as it is (`typed`). `plans` — the budget's income plans in their categories' currencies; `cells` — one month's.
 */
export function legacyIncome(
  plans: readonly { readonly categoryId: string; readonly amount: Money }[],
  cells: readonly PlanCell[],
  categories: ReadonlyMap<string, BudgetCategory>,
  currency: string,
): { readonly cells: readonly PlanCell[]; readonly typed: Money | null } | null {
  const legacy = cells.find((c) => c.kind === "income" && c.lineId === null && c.amount !== null);
  if (!legacy || plans.length === 0 || legacy.amount!.currency !== currency) return null;
  const shown = (id: string) => shownCategory(categories.get(id), "income");
  if (cells.some((c) => c.kind === "income" && c.lineId !== null && c.amount !== null && shown(c.lineId)))
    return null;
  const own = plans.filter((l) => l.amount.currency === currency);
  const eligible = own
    .filter((l) => shown(l.categoryId))
    .sort((a, b) => b.amount.compare(a.amount) || (a.categoryId < b.categoryId ? -1 : 1));
  const rest = legacy.amount!.minus(
    sum(
      own.filter((l) => !shown(l.categoryId)).map((l) => l.amount),
      currency,
    ),
  );
  if (eligible.length === 0 || rest.isNegative()) return { cells: [], typed: legacy.amount };
  let left = rest;
  const shares = eligible.map((l) => {
    const share = left.compare(l.amount) < 0 ? left : l.amount;
    left = left.minus(share);
    return share;
  });
  shares[0] = shares[0]!.plus(left);
  return {
    cells: eligible.map((l, i) => ({
      period: legacy.period,
      kind: "income" as const,
      lineId: l.categoryId,
      amount: shares[i]!,
      version: 1,
    })),
    typed: null,
  };
}

/** The budget's income plans in their categories' own currencies (`original` — a category in another currency). */
const ownPlans = (base: PeriodPlan) =>
  (base.incomePlans ?? []).map((l) => ({ categoryId: l.categoryId, amount: l.original ?? l.amount }));

/** A month's cells with its typed «План доходу» laid out (`legacyIncome`); `typed` — it counts as it is. */
function withLegacyIncome(
  base: PeriodPlan,
  cells: readonly PlanCell[],
  categories: ReadonlyMap<string, BudgetCategory>,
): { readonly cells: readonly PlanCell[]; readonly typed: Money | null } {
  const legacy = legacyIncome(ownPlans(base), cells, categories, base.incomePlan.currency);
  return legacy ? { cells: [...cells, ...legacy.cells], typed: legacy.typed } : { cells, typed: null };
}

/**
 * FR 1 (owner decision 2026-11-21, 2 б): the income plan of each category of the month — a shown income category's own
 * cell (in its own currency, BUD-02 FR 24) replaces its plan for that month; a category hidden or merged keeps the
 * budget-wide plan, as a limit does. Null — no own cell counts: the lines are the budget's as they are.
 */
function incomeLinesOf(
  base: PeriodPlan,
  cells: readonly PlanCell[],
  categories: ReadonlyMap<string, BudgetCategory>,
  rates: PlanRates,
): IncomePlanLine[] | null {
  const lines = base.incomePlans ?? [];
  let changed = false;
  const next = lines.map((l) => {
    const own = shownCategory(categories.get(l.categoryId), "income")
      ? ownCell(cells, "income", l.categoryId)
      : null;
    if (!own) return l;
    changed = true;
    const [line] = convertLines([{ categoryId: l.categoryId, amount: own }], base.incomePlan.currency, rates);
    return line!;
  });
  return changed ? next : null;
}

/**
 * FR 1: the month's income plan — the sum of its income categories' rows (each its own cell, else its plan); a budget
 * without income categories (its plan without categories, BUD-02 FR 21) — that plan, or the month's own value typed
 * before row 231 (the nil line, read only now).
 */
export function incomeOf(
  base: PeriodPlan,
  cells: readonly PlanCell[],
  categories: ReadonlyMap<string, BudgetCategory>,
  rates: PlanRates = ratesMap(base.rates),
): Money {
  if ((base.incomePlans ?? []).length === 0) return ownCell(cells, "income", null) ?? base.incomePlan;
  const legacy = withLegacyIncome(base, cells, categories);
  if (legacy.typed) return legacy.typed;
  const lines = incomeLinesOf(base, legacy.cells, categories, rates);
  return lines
    ? sum(
        lines.map((l) => l.amount),
        base.incomePlan.currency,
      )
    : base.incomePlan;
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
  // FR 1 (owner decision 2026-11-21, 2 б): a category's own cell is that month's plan of the category (BUD-02 FR 9,
  // FR 11: the card «Дохід» and the snapshot), and the income plan is their sum.
  const legacy = withLegacyIncome(base, set, categories);
  const incomePlans = legacy.typed ? null : incomeLinesOf(base, legacy.cells, categories, rates);
  return withPlanRates(
    {
      ...base,
      incomePlan: incomeOf(base, set, categories, rates),
      ...(incomePlans ? { incomePlans } : base.incomePlans ? { incomePlans: base.incomePlans } : {}),
      plannedSavings: base.plannedSavings.plus(sum(savings, base.plannedSavings.currency)),
      limits: [...limits.values()],
    },
    rates,
  );
}

/** BUD-17 business rules: a limit's or an income plan's default cell — in the category's own currency (BUD-02 FR 24). */
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
     * FR 1 (owner decision 2026-11-21, 2 б): a row per active income category of the budget's plan, in the tree's
     * order; a cell — the category's plan of the month in its own currency (default — its plan in the budget). No
     * «План доходу», no «Інші надходження», no regular incomes (they are in their category's fact).
     */
    readonly categories: readonly { readonly categoryId: string; readonly cells: readonly GridCell[] }[];
    /** The month's income plan: the sum of the rows in the budget's currency; null — a row without a rate. */
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
  const byId = new Map(input.categories.map((c) => [c.id, c]));
  const monthCells = (m: GridMonth) => input.cells.filter((c) => c.period === m.period);
  // Row 231: a month's «План доходу» typed before is shown laid out on its rows (`legacyIncome`).
  for (const m of months) {
    const b = base(m);
    const laid = m.inBudget && b ? withLegacyIncome(b, monthCells(m), byId).cells : [];
    for (const c of laid) {
      const key = `${c.period}/${cellKey(c.kind, c.lineId)}`;
      if (!cells.get(key)?.amount) cells.set(key, c);
    }
  }
  const total = (rows: readonly (readonly { amount: Money | null }[])[], i: number): Money | null =>
    months[i]!.inBudget
      ? sum(
          rows.flatMap((r) => (r[i]!.amount ? [r[i]!.amount!] : [])),
          currency,
        )
      : null;

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
  // FR 1 (owner decision 2026-11-21, 2 б): a row per active income category of the budget's plan, in the tree's order.
  const planned = new Set(months.flatMap((m) => (base(m)?.incomePlans ?? []).map((l) => l.categoryId)));
  const incomeRows = input.categories
    .filter((c) => active(c, "income") && planned.has(c.id))
    .map((c) => ({
      categoryId: c.id,
      cells: months.map((m) =>
        cellOf(m, "income", c.id, lineAmount(base(m)?.incomePlans?.find((l) => l.categoryId === c.id))),
      ),
    }));
  // BUD-17 business rules (owner decision 2026-11-26): a category's cell is in its own currency; the section's sum is
  // in the budget's, each cell at today's rate — a cell without a rate leaves the month without a sum.
  const rates = input.rates ?? new Map<string, PlanRate>();
  const used = new Map<string, PlanRate>();
  const inBudget = (rows: readonly (readonly GridCell[])[]) =>
    rows.map((r) =>
      r.map((c) => {
        if (!c.amount || c.amount.currency === currency) return { amount: c.amount, unknown: false };
        const converted = inBudgetCurrency(c.amount, currency, rates);
        if (converted) used.set(c.amount.currency, rates.get(c.amount.currency)!);
        return { amount: converted, unknown: converted === null };
      }),
    );
  const expenseRows = inBudget([...groups.values()].flat().map((r) => r.cells));
  const incomeConverted = inBudget(incomeRows.map((r) => r.cells));
  const known = (rows: readonly (readonly { unknown: boolean }[])[], i: number) =>
    rows.every((r) => !r[i]!.unknown);

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

  // FR 1, BUD-03 FR 2: the section's sum is the month's income plan (`incomeOf`, the figure of the period and «Можна
  // витратити»), with the same categories — a row without a rate leaves the month without a sum.
  const incomeTotals = months.map((m, i) => {
    const b = base(m);
    if (!m.inBudget || !b || !known(incomeConverted, i)) return null;
    return incomeOf(b, monthCells(m), byId, rates);
  });
  const expenseTotals = months.map((_, i) => (known(expenseRows, i) ? total(expenseRows, i) : null));
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
    income: { categories: incomeRows, totals: incomeTotals },
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
