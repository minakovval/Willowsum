import type { ApiClient, operations } from "@willowsum/api-contract";
import { Decimal } from "@willowsum/domain-kernel";
import { outcome } from "../../auth/api.ts";
import type { Load } from "../../recurring/data.ts";
import { monthOf, shiftMonth } from "../budget/model.ts";

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

/**
 * BUD-16@PoC b) (wave 2, row 133): what S-133 «Тренд» reads — `GET /v1/budget` (the first period of the budget, for
 * «Усе»), `GET /v1/budget/trend` (the plan, the spending and the income of each month) and `GET /v1/categories`
 * (the filter). The amounts are shown as the API gives them.
 */
export type TrendResponse = Json<operations["getBudgetTrend"]>;
export type TrendMonth = TrendResponse["months"][number];
export type Money = NonNullable<TrendMonth["plan"]>;

/** CHT-01 FR 12: the one set of chart periods «1М · 3М · 1Р · Усе»; the screen's default is «1Р» (the board). */
export const RANGES = ["1m", "3m", "1y", "all"] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = "1y";
const SPAN: Readonly<Record<Exclude<Range, "all">, number>> = { "1m": 1, "3m": 3, "1y": 12 };

/** The most months one `GET /v1/budget/trend` answers (`to` is at most 120 months from `from`); #603, row 133. */
export const MAX_MONTHS = 120;

/** `[from, to]` of every request that covers `from … to` (inclusive) in windows of at most 120 months (#603). */
export function windows(from: string, to: string): readonly (readonly [string, string])[] {
  const out: [string, string][] = [];
  let start = from;
  while (start <= to) {
    const end = shiftMonth(start, MAX_MONTHS - 1);
    out.push([start, end < to ? end : to]);
    start = shiftMonth(start, MAX_MONTHS);
  }
  return out;
}

export interface TrendView {
  readonly currency: string;
  /** The completed months, oldest first. */
  readonly months: readonly TrendMonth[];
  readonly nearestRateCount: number;
}
/** `empty`: no budget yet, or no month of it has ended (the screen's empty state). */
export type TrendData = { readonly kind: "empty" } | ({ readonly kind: "ready" } & TrendView);

/**
 * The completed periods of the range, ending with the month before `today`'s. A range starts no earlier than the
 * first period of the budget: before it the budget has no plan, and its history is not the trend of this budget.
 */
export async function loadTrend(
  api: ApiClient,
  range: Range,
  categoryId: string | null,
  today: string,
): Promise<Load<TrendData>> {
  const budget = await outcome(api.GET("/v1/budget"));
  if (!budget.ok) return { state: "error", failure: budget };
  if (budget.data.budget === null) return { state: "ready", data: { kind: "empty" } };
  const to = shiftMonth(monthOf(today), -1);
  const first = budget.data.budget.firstPeriod;
  const wanted = range === "all" ? first : shiftMonth(to, 1 - SPAN[range]);
  const from = wanted > first ? wanted : first;
  if (from > to) return { state: "ready", data: { kind: "empty" } };
  const answers = await Promise.all(
    windows(from, to).map(([f, t]) =>
      outcome(
        api.GET("/v1/budget/trend", {
          params: { query: { from: f, to: t, ...(categoryId ? { categoryId } : {}) } },
        }),
      ),
    ),
  );
  const months: TrendMonth[] = [];
  let nearestRateCount = 0;
  let currency = "";
  for (const a of answers) {
    if (!a.ok) return { state: "error", failure: a };
    months.push(...a.data.months);
    nearestRateCount += a.data.approximate.nearestRateCount;
    currency = a.data.currency;
  }
  return { state: "ready", data: { kind: "ready", currency, months, nearestRateCount } };
}

/** The month with the highest and the lowest spending (the first of equal ones); `null` for fewer than two months. */
export function extremes(months: readonly TrendMonth[]): { high: TrendMonth; low: TrendMonth } | null {
  const spent = months.filter((m) => m.spent !== null);
  if (spent.length < 2) return null;
  let high = spent[0]!;
  let low = spent[0]!;
  for (const m of spent) {
    if (new Decimal(m.spent!.amount).gt(high.spent!.amount)) high = m;
    if (new Decimal(m.spent!.amount).lt(low.spent!.amount)) low = m;
  }
  return { high, low };
}

/** «Факт − план» of a month: `null` when there is no plan (a month before the budget) or no fact. */
export function difference(m: TrendMonth): string | null {
  if (m.spent === null || m.plan === null) return null;
  return new Decimal(m.spent.amount).minus(m.plan.amount).toFixed(2);
}

/** The first and the last day of a `YYYY-MM` month: the period a column opens in «Транзакції». */
export function monthBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}
