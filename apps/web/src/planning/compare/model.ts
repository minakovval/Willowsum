import type { ApiClient, operations } from "@willowsum/api-contract";
import { outcome } from "../../auth/api.ts";
import type { Load } from "../../recurring/data.ts";
import { monthOf, shiftMonth } from "../budget/model.ts";

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

/** BUD-06@PoC a) (#605, #625): `GET /v1/budget/compare` and `/year`. Amounts are decimal strings: never summed or sorted here. */
export type Compare = Json<operations["getBudgetCompare"]>;
export type CompareYear = Json<operations["getBudgetCompareYear"]>;
export type Money = Compare["expenses"]["overall"]["current"];
export type Change = NonNullable<Compare["expenses"]["overall"]["difference"]>;
export type Row = Compare["expenses"]["overall"];
export type BaseId = Compare["base"]["base"];
export type PeriodType = Compare["type"];

/** CMP-72@PoC: the types the page allows (BUD-06: «Власний» is MVP). */
export const TYPES: readonly PeriodType[] = ["month", "quarter", "ytd", "year"];
export type View = "compare" | "year";

export interface State {
  readonly type: PeriodType;
  /** month `2026-10`, quarter `2026-Q4`, ytd and year `2026`. */
  readonly period: string;
  /** `null` — the default of the type. */
  readonly base: BaseId | null;
  /** «Повний попередній період». */
  readonly full: boolean;
  readonly view: View;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const QUARTER = /^\d{4}-Q[1-4]$/;
const YEAR = /^\d{4}$/;
const valid = (type: PeriodType, period: string): boolean =>
  type === "month" ? MONTH.test(period) : type === "quarter" ? QUARTER.test(period) : YEAR.test(period);
const BASES: readonly BaseId[] = ["previous", "last-year", "avg3", "avg6", "avg12"];

/** CMP-72 «Стани»: the default is the last finished month. */
export const defaultState = (today: string): State => ({
  type: "month",
  period: shiftMonth(monthOf(today), -1),
  base: null,
  full: false,
  view: "compare",
});

/** `#/planning/budget/compare?type=month&period=2026-10&base=avg3&full=true&view=year` (the address keeps the choice). */
export function stateFromHash(hash: string, today: string): State {
  const at = hash.indexOf("?");
  const q = new URLSearchParams(at < 0 ? "" : hash.slice(at + 1));
  const dflt = defaultState(today);
  const type = TYPES.find((x) => x === q.get("type")) ?? dflt.type;
  const period = q.get("period") ?? "";
  const base = BASES.find((x) => x === q.get("base")) ?? null;
  return {
    type,
    period: valid(type, period)
      ? period
      : type === dflt.type
        ? dflt.period
        : anchorTo(type, dflt.type, dflt.period, today),
    base: allowedBases(type).includes(base as BaseId) ? base : null,
    full: q.get("full") === "true",
    view: q.get("view") === "year" ? "year" : "compare",
  };
}

export function hashOf(path: string, s: State): string {
  const q = new URLSearchParams({ type: s.type, period: s.period });
  if (s.base) q.set("base", s.base);
  if (s.full) q.set("full", "true");
  if (s.view === "year") q.set("view", "year");
  return `${path}?${q.toString()}`;
}

/** BUD-06 FR 1: year and ytd take only the last year as the base. */
export const allowedBases = (type: PeriodType): readonly BaseId[] =>
  type === "year" || type === "ytd" ? ["last-year"] : BASES;
export const defaultBase = (type: PeriodType): BaseId =>
  type === "year" || type === "ytd" ? "last-year" : "previous";

// ---- periods ----

const quarterOf = (month: string): string => `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5)) / 3)}`;
/** The last month of a period; for ytd the month of today (the same date of a past year). */
export function lastMonthOf(type: PeriodType, period: string, today: string): string {
  const current = monthOf(today);
  if (type === "month") return period;
  if (type === "quarter")
    return `${period.slice(0, 4)}-${String(Number(period.slice(6)) * 3).padStart(2, "0")}`;
  if (type === "ytd") return `${period}-${current.slice(5)}`;
  return `${period}-12`;
}
export const firstMonthOf = (type: PeriodType, period: string): string =>
  type === "month"
    ? period
    : type === "quarter"
      ? `${period.slice(0, 4)}-${String((Number(period.slice(6)) - 1) * 3 + 1).padStart(2, "0")}`
      : `${period}-01`;

/** CMP-72 «Стани»: a change of type keeps the closest period of the new type that holds the old one (October → III quarter → 2026). */
export function anchorTo(to: PeriodType, from: PeriodType, period: string, today: string): string {
  const current = monthOf(today);
  let month = lastMonthOf(from, period, today);
  if (month > current) month = current;
  return to === "month" ? month : to === "quarter" ? quarterOf(month) : month.slice(0, 4);
}

export function shiftPeriod(type: PeriodType, period: string, by: number): string {
  if (type === "month") return shiftMonth(period, by);
  if (type === "quarter") {
    const index = Number(period.slice(0, 4)) * 4 + Number(period.slice(6)) - 1 + by;
    return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
  }
  return String(Number(period) + by);
}

/** «›» is off while the next period has not started. */
export const isLatest = (type: PeriodType, period: string, today: string): boolean =>
  firstMonthOf(type, shiftPeriod(type, period, 1)) > monthOf(today);

/** «‹» is off when the earlier period ends before the history begins (`firstMonth` unknown while the first answer loads). */
export const hasEarlier = (type: PeriodType, period: string, firstMonth: string | null): boolean =>
  firstMonth === null || lastMonthOf(type, shiftPeriod(type, period, -1), "9999-12-31") >= firstMonth;

/** The periods the name's list offers, newest first. */
export function periodsOf(type: PeriodType, firstMonth: string | null, today: string): string[] {
  const current = monthOf(today);
  const from = firstMonth ?? shiftMonth(current, -23);
  const out: string[] = [];
  let p = anchorTo(type, "month", current, today);
  const start = anchorTo(type, "month", from, today);
  for (let i = 0; i < 400 && p >= start; i++) {
    out.push(p);
    p = shiftPeriod(type, p, -1);
  }
  return out;
}

// ---- loading ----

export interface CompareData {
  readonly compare: Compare;
  /** The names of the categories by id. */
  readonly names: ReadonlyMap<string, string>;
}

export async function loadCompare(api: ApiClient, s: State): Promise<Load<CompareData>> {
  const [compare, categories] = await Promise.all([
    outcome(
      api.GET("/v1/budget/compare", {
        params: {
          query: {
            type: s.type,
            period: s.period,
            ...(s.base ? { base: s.base } : {}),
            ...(s.full ? { full: "true" as const } : {}),
          },
        },
      }),
    ),
    outcome(api.GET("/v1/categories")),
  ]);
  if (!compare.ok) return { state: "error", failure: compare };
  return {
    state: "ready",
    data: { compare: compare.data, names: namesOf(categories.ok ? categories.data : null) },
  };
}

export interface YearData {
  readonly year: CompareYear;
  readonly names: ReadonlyMap<string, string>;
  readonly groups: ReadonlyMap<string, string>;
}

export async function loadYear(api: ApiClient, year: string): Promise<Load<YearData>> {
  const [res, categories] = await Promise.all([
    outcome(api.GET("/v1/budget/compare/year", { params: { query: { year } } })),
    outcome(api.GET("/v1/categories")),
  ]);
  if (!res.ok) return { state: "error", failure: res };
  const tree = categories.ok ? categories.data : null;
  return {
    state: "ready",
    data: {
      year: res.data,
      names: namesOf(tree),
      groups: new Map((tree?.groups ?? []).map((g): [string, string] => [g.id, g.name])),
    },
  };
}

function namesOf(
  tree: { groups: readonly { categories: readonly { id: string; name: string }[] }[] } | null,
) {
  const out = new Map<string, string>();
  for (const g of tree?.groups ?? []) for (const c of g.categories) out.set(c.id, c.name);
  return out;
}

/** The year whose «Рік: план і факт» the view shows: the calendar year of the chosen period (BUD-06 FR 11). */
export const yearOf = (s: State): string => s.period.slice(0, 4);
