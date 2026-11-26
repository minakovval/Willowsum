import type { ApiClient, operations } from "@willowsum/api-contract";
import { outcome, type Outcome } from "../../auth/api.ts";
import type { Load } from "../../recurring/data.ts";

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

/**
 * BUD-17@PoC b) (wave 2, row 127): what S-126 «Бюджет → План» reads — `GET /v1/budget/plan-grid` (the 12 months of
 * income, limits, goals and savings, debt payments and «Не розподілено») and, for the row names, the categories,
 * the goals, the debts and the regular payments. Every amount is a decimal string, from the API to the input and back: the page adds
 * nothing up (the sums and «Не розподілено» are the server's) and never turns an amount into a number. Row 231
 * (owner decision 2026-11-21, 2 б): «Надходження» is a row per income category of the budget's plan.
 */
export type Grid = Json<operations["getBudgetPlanGrid"]>;
export type Money = { readonly amount: string; readonly currency: string };
export type CellKind = "income" | "limit" | "goal" | "savings";
export type SectionId = "income" | "expenses" | "goals" | "debts";

/** What a saved cell needs to be addressed again (`PUT /v1/budget/plan-grid/cells`). */
export interface CellEdit {
  readonly kind: CellKind;
  readonly lineId: string | null;
  /** The version the user saw (0 — no own value yet). */
  readonly version: number;
  /** The month has a value of its own (an empty input takes it back to the default). */
  readonly own: boolean;
}

export interface PlanCell {
  readonly period: string;
  readonly amount: Money | null;
  /** `null`: read only (a debt payment, a month that is over). */
  readonly edit: CellEdit | null;
}

export type RowLabel =
  | { readonly kind: "name"; readonly name: string }
  | { readonly kind: "savings" }
  | { readonly kind: "debtMinimum" | "debtExtra"; readonly name: string };

export interface PlanRow {
  readonly id: string;
  readonly label: RowLabel;
  readonly cells: readonly PlanCell[];
  /** A row nobody can change in this release (the debt payments): shown with a lock. */
  readonly locked: boolean;
  /**
   * BUD-17 business rules (owner decision 2026-11-26): the currency of the row's cells — a category's is that of its
   * limit or its income plan (BUD-02 FR 24), the one its values come in; without any value, the budget's.
   */
  readonly currency: string;
}

export type SectionItem =
  | { readonly type: "group"; readonly id: string; readonly name: string }
  | { readonly type: "row"; readonly row: PlanRow };

export interface PlanSection {
  readonly id: SectionId;
  readonly totals: readonly (Money | null)[];
  readonly items: readonly SectionItem[];
  /** A row in another currency is in the sums at today's rate (`PlanView.rates`): they are shown with «≈». */
  readonly approximate: boolean;
}

export interface PlanView {
  readonly currency: string;
  readonly months: Grid["months"];
  readonly sections: readonly PlanSection[];
  readonly unallocated: Grid["unallocated"];
  /** The rates (today's) the cells of another currency are summed at; empty — no «≈». */
  readonly rates: Grid["rates"];
}

export type PlanData =
  { readonly kind: "none" } | { readonly kind: "ready"; readonly grid: Grid; readonly names: Names };

export interface Names {
  readonly categories: ReadonlyMap<string, string>;
  readonly groups: ReadonlyMap<string, string>;
  readonly goals: ReadonlyMap<string, string>;
  readonly debts: ReadonlyMap<string, string>;
  /** The regular payments (the card «Можна витратити» names them; the grid has no row of them since row 231). */
  readonly payments: ReadonlyMap<string, string>;
}

/** The calendar month of an ISO date («2026-11-18» → «2026-11»). */
export const monthOf = (isoDate: string): string => isoDate.slice(0, 7);

/**
 * The cells of one row. A month that is already over (the page was left open past the turn of the month) or outside
 * the budget is read only (FR 2, AC3): the server refuses it too (`400 period`).
 */
function cellsOf(
  grid: Grid,
  today: string,
  values: readonly { amount: Money | null; own: boolean; version: number }[],
  address: { kind: CellKind; lineId: string | null } | null,
): PlanCell[] {
  const now = monthOf(today);
  return grid.months.map((month, i) => {
    const v = values[i];
    const open = address !== null && month.inBudget && month.period >= now;
    return {
      period: month.period,
      amount: v?.amount ?? null,
      edit: open && v ? { kind: address.kind, lineId: address.lineId, version: v.version, own: v.own } : null,
    };
  });
}

const readOnly = (grid: Grid, amounts: readonly (Money | null)[]): PlanCell[] =>
  grid.months.map((m, i) => ({ period: m.period, amount: amounts[i] ?? null, edit: null }));

export function buildView(grid: Grid, names: Names, today: string): PlanView {
  const row = (id: string, label: RowLabel, cells: PlanCell[], locked = false): SectionItem => ({
    type: "row",
    row: {
      id,
      label,
      cells,
      locked,
      currency: cells.find((c) => c.amount !== null)?.amount?.currency ?? grid.currency,
    },
  });

  // «Надходження» (owner decision 2026-11-21, 2 б): a row per income category of the budget's plan, in its currency.
  const income: SectionItem[] = grid.income.categories.map((c) =>
    row(
      `income-${c.categoryId}`,
      { kind: "name", name: names.categories.get(c.categoryId) ?? "" },
      cellsOf(grid, today, c.cells, { kind: "income", lineId: c.categoryId }),
    ),
  );

  const expenses: SectionItem[] = grid.expenses.groups.flatMap((g): SectionItem[] => {
    const name = g.groupId === null ? undefined : names.groups.get(g.groupId);
    return [
      ...(name ? [{ type: "group" as const, id: g.groupId ?? "none", name }] : []),
      ...g.categories.map((c) =>
        row(
          `limit-${c.categoryId}`,
          { kind: "name", name: names.categories.get(c.categoryId) ?? "" },
          cellsOf(grid, today, c.cells, { kind: "limit", lineId: c.categoryId }),
        ),
      ),
    ];
  });

  const goals: SectionItem[] = [
    ...grid.goals.rows.map((r) =>
      row(
        `goal-${r.goalId}`,
        { kind: "name", name: names.goals.get(r.goalId) ?? "" },
        cellsOf(grid, today, r.cells, { kind: "goal", lineId: r.goalId }),
      ),
    ),
    row(
      "savings",
      { kind: "savings" },
      cellsOf(grid, today, grid.goals.savings, { kind: "savings", lineId: null }),
    ),
  ];

  // «Погашення боргів»: a debt has the minimum payment and the extra one of its saved plan, each its own row.
  const debts: SectionItem[] = grid.debts.rows.flatMap((r): SectionItem[] => {
    const name = names.debts.get(r.accountId) ?? "";
    const minimum = r.cells.map((c) => c.minimum);
    const extra = r.cells.map((c) => c.extra);
    return [
      ...(minimum.some((m) => m !== null)
        ? [row(`debt-min-${r.accountId}`, { kind: "debtMinimum", name }, readOnly(grid, minimum), true)]
        : []),
      ...(extra.some((m) => m !== null)
        ? [row(`debt-extra-${r.accountId}`, { kind: "debtExtra", name }, readOnly(grid, extra), true)]
        : []),
    ];
  });

  const section = (id: SectionId, totals: PlanSection["totals"], items: SectionItem[]): PlanSection => ({
    id,
    totals,
    items,
    approximate:
      grid.rates.length > 0 && items.some((i) => i.type === "row" && i.row.currency !== grid.currency),
  });
  return {
    currency: grid.currency,
    months: grid.months,
    unallocated: grid.unallocated,
    rates: grid.rates,
    sections: [
      section("income", grid.income.totals, income),
      section("expenses", grid.expenses.totals, expenses),
      section("goals", grid.goals.totals, goals),
      section("debts", grid.debts.totals, debts),
    ],
  };
}

/** The grid alone (after a save the names do not change). */
export const readGrid = (api: ApiClient): Promise<Outcome<Grid>> => outcome(api.GET("/v1/budget/plan-grid"));

export async function loadNames(api: ApiClient): Promise<Outcome<Names>> {
  const [categories, goals, debts, payments] = await Promise.all([
    outcome(api.GET("/v1/categories")),
    outcome(api.GET("/v1/goals")),
    outcome(api.GET("/v1/debts")),
    outcome(api.GET("/v1/recurring/payments")),
  ]);
  if (!categories.ok) return categories;
  if (!goals.ok) return goals;
  if (!debts.ok) return debts;
  if (!payments.ok) return payments;
  const groups = new Map<string, string>();
  const names = new Map<string, string>();
  for (const g of categories.data.groups) {
    groups.set(g.id, g.name);
    for (const c of g.categories) names.set(c.id, c.name);
  }
  return {
    ok: true,
    data: {
      categories: names,
      groups,
      goals: new Map(goals.data.goals.map((g) => [g.id, g.name])),
      debts: new Map(debts.data.debts.map((d) => [d.accountId, d.name])),
      payments: new Map(payments.data.items.map((p) => [p.id, p.name])),
    },
  };
}

/**
 * «План ще не заповнено»: without a budget the grid is 404 (so it is with the flag `budget.plan` off, which the page
 * shows the same way: there is nothing to fill in yet).
 */
export async function loadPlan(api: ApiClient): Promise<Load<PlanData>> {
  const grid = await readGrid(api);
  if (!grid.ok) {
    if (grid.kind === "problem" && grid.problem.code === "NOT_FOUND")
      return { state: "ready", data: { kind: "none" } };
    return { state: "error", failure: grid };
  }
  const names = await loadNames(api);
  if (!names.ok) return { state: "error", failure: names };
  return { state: "ready", data: { kind: "ready", grid: grid.data, names: names.data } };
}
