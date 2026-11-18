import type { ApiClient, operations } from "@willowsum/api-contract";
import { Decimal } from "@willowsum/domain-kernel";
import { usageState, type UsageState } from "@willowsum/ui";
import { outcome, type Outcome } from "../../auth/api.ts";
import type { Load } from "../../recurring/data.ts";

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

/**
 * BUD-02@PoC d) (wave 2, row 123): what S-121 «Бюджет» and S-289 read — `GET /v1/budget` (is there a budget, its first
 * period), `GET /v1/budget/periods/{period}` (the plan and the fact of one month: groups, categories, totals) and
 * `GET /v1/categories` for the names and the groups. The amounts are shown as the API gives them.
 */
export type Period = Json<operations["getBudgetPeriod"]>;
export type Money = Period["incomePlan"];
type Tree = Json<operations["listCategories"]>;

/** The state of a row on the usage scale (DS-23 family «а»), or «поза планом» for a category without a limit. */
export type RowState = UsageState | "outOfPlan";

export interface Row {
  readonly id: string;
  readonly name: string;
  /** The group's id; `outside` for the rows of «Поза планом». */
  readonly groupId: string;
  readonly mandatory: boolean;
  readonly limit: Money | null;
  readonly spent: Money | null;
  readonly remaining: Money | null;
  readonly state: RowState | null;
}

export interface Section {
  readonly id: string;
  readonly name: string;
  readonly rows: readonly Row[];
}

export const OUTSIDE = "outside";

export interface BudgetView {
  readonly firstPeriod: string;
  readonly period: Period;
  readonly sections: readonly Section[];
  /** The rows of «Поза планом» (a category without a limit). */
  readonly outside: readonly Row[];
}

export type BudgetData =
  { readonly kind: "none" } | { readonly kind: "before" } | ({ readonly kind: "ready" } & BudgetView);

export const monthOf = (isoDate: string): string => isoDate.slice(0, 7);

/** The month before or after `period` («2026-11» → «2026-12»). */
export function shiftMonth(period: string, by: number): string {
  const [y, m] = period.split("-").map(Number);
  const index = (y ?? 1970) * 12 + ((m ?? 1) - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
/** `#/planning/budget?period=2026-12` (S-289): a month of the hash, or `null` for the current one. */
export function periodFromHash(hash: string): string | null {
  const at = hash.indexOf("?");
  const value = at < 0 ? null : new URLSearchParams(hash.slice(at + 1)).get("period");
  return value !== null && PERIOD.test(value) ? value : null;
}

export function stateOf(spent: Money | null, limit: Money | null, mandatory: boolean): RowState | null {
  if (limit === null) return "outOfPlan";
  if (spent === null) return null;
  return new Decimal(limit.amount).gt(0) ? usageState(spent.amount, limit.amount, mandatory) : "outOfPlan";
}

function build(period: Period, tree: Tree): Omit<BudgetView, "firstPeriod"> {
  const categories = new Map<string, { name: string }>();
  const groups = new Map<string, string>();
  for (const g of tree.groups) {
    groups.set(g.id, g.name);
    for (const c of g.categories) categories.set(c.id, { name: c.name });
  }
  const sections: Section[] = period.groups.map((g) => {
    const id = g.groupId ?? "none";
    return {
      id,
      name: (g.groupId !== null ? groups.get(g.groupId) : undefined) ?? "",
      rows: g.categories.map((c) => ({
        id: c.categoryId,
        name: categories.get(c.categoryId)?.name ?? "",
        groupId: id,
        mandatory: c.mandatory,
        limit: c.limit,
        spent: c.spent,
        remaining: c.remaining,
        state: stateOf(c.spent, c.limit, c.mandatory),
      })),
    };
  });
  const outside: Row[] = period.outsidePlan.categories.map((c) => ({
    id: c.categoryId ?? "none",
    name: (c.categoryId !== null ? categories.get(c.categoryId)?.name : undefined) ?? "",
    groupId: OUTSIDE,
    mandatory: false,
    limit: null,
    spent: c.spent,
    remaining: null,
    state: "outOfPlan",
  }));
  return { period, sections, outside };
}

export async function loadBudget(
  api: ApiClient,
  requested: string | null,
  today: string,
): Promise<Load<BudgetData>> {
  const budget = await outcome(api.GET("/v1/budget"));
  if (!budget.ok) return { state: "error", failure: budget };
  if (budget.data.budget === null) return { state: "ready", data: { kind: "none" } };
  const period = requested ?? monthOf(today);
  const [periodResult, categories] = await Promise.all([
    outcome(api.GET("/v1/budget/periods/{period}", { params: { path: { period } } })),
    outcome(api.GET("/v1/categories")),
  ]);
  if (!periodResult.ok) return beforeStart(periodResult);
  if (!categories.ok) return { state: "error", failure: categories };
  return {
    state: "ready",
    data: {
      kind: "ready",
      firstPeriod: budget.data.budget.firstPeriod,
      ...build(periodResult.data, categories.data),
    },
  };
}

/** BUD-02 «Граничні випадки»: a date before the first period is «Бюджет ще не існував на цю дату», not an error. */
function beforeStart(o: Exclude<Outcome<unknown>, { ok: true }>): Load<BudgetData> {
  if (o.kind === "problem" && o.problem.code === "BUDGET_PERIOD_BEFORE_START")
    return { state: "ready", data: { kind: "before" } };
  return { state: "error", failure: o };
}

// ---- the filter of the card «Категорії» (BUD-02 FR 20, CMP-32 FR 8) ----

export type TypeValue = "mandatory" | "optional";
export type StateValue = "notStarted" | "remaining" | "almost" | "exhausted" | "over" | "outOfPlan";
export const TYPE_VALUES: readonly TypeValue[] = ["mandatory", "optional"];
export const STATE_VALUES: readonly StateValue[] = [
  "notStarted",
  "remaining",
  "almost",
  "exhausted",
  "over",
  "outOfPlan",
];

export interface Filters {
  readonly type: ReadonlySet<TypeValue>;
  readonly state: ReadonlySet<StateValue>;
  readonly groups: ReadonlySet<string>;
}
export const NO_FILTERS: Filters = { type: new Set(), state: new Set(), groups: new Set() };
export const filterCount = (f: Filters): number => f.type.size + f.state.size + f.groups.size;

/** «Вичерпано» holds both «ліміт вичерпано» of a mandatory category and «вичерпано» of an optional one. */
export const stateValueOf = (row: Row): StateValue | null =>
  row.state === null ? null : row.state === "limitReached" ? "exhausted" : row.state;

/** The values of one row on the three axes; an empty set of an axis matches every row (the axes are ANDed). */
export function matches(row: Row, f: Filters): boolean {
  const type: TypeValue = row.mandatory ? "mandatory" : "optional";
  if (f.type.size > 0 && !f.type.has(type)) return false;
  const state = stateValueOf(row);
  if (f.state.size > 0 && (state === null || !f.state.has(state))) return false;
  return f.groups.size === 0 || f.groups.has(row.groupId);
}

export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

// ---- sorting inside a group ----

export type SortKey = "category" | "spent" | "limit" | "remaining";
export interface Sort {
  readonly key: SortKey;
  readonly direction: "asc" | "desc";
}

const amountOf = (row: Row, key: Exclude<SortKey, "category">): Decimal | null => {
  const money = key === "spent" ? row.spent : key === "limit" ? row.limit : row.remaining;
  return money === null ? null : new Decimal(money.amount);
};

/** Only compares the amounts; a row without the value goes last in either direction. */
export function sortRows(rows: readonly Row[], sort: Sort | undefined, locale: string): readonly Row[] {
  if (!sort) return rows;
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === "category") return sign * a.name.localeCompare(b.name, locale);
    const x = amountOf(a, sort.key);
    const y = amountOf(b, sort.key);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * x.comparedTo(y);
  });
}

// ---- the totals row (BUD-02 FR 19): the numbers the API does not give yet ----

/** «Перевитрата C у N категоріях»: the sum of the negative remainders as a positive amount (exact, not rounded) and how many there are. */
export function overspend(rows: readonly Row[]): (Money & { count: number }) | null {
  let sum = new Decimal("0");
  let count = 0;
  let currency = "";
  for (const row of rows) {
    if (row.remaining === null || !new Decimal(row.remaining.amount).lt(0)) continue;
    sum = sum.plus(row.remaining.amount);
    currency = row.remaining.currency;
    count += 1;
  }
  return count === 0 ? null : { count, amount: sum.abs().toFixed(), currency };
}

/** The sum of the limits of the optional categories: the base of the overspend shade (DS-23 FR 4). */
export function optionalLimits(rows: readonly Row[]): string {
  return rows
    .reduce((sum, r) => (r.mandatory || r.limit === null ? sum : sum.plus(r.limit.amount)), new Decimal("0"))
    .toFixed();
}
