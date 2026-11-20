import type { ApiClient, operations } from "@willowsum/api-contract";
import { Decimal } from "@willowsum/domain-kernel";
import { outcome } from "../../auth/api.ts";
import type { Load } from "../../recurring/data.ts";
import { anchorTo, TYPES, type PeriodType } from "../compare/model.ts";
import { monthOf } from "../budget/model.ts";

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

/**
 * BUD-08@PoC b) (wave 2, row 134): what S-134 «Грошовий потік» reads — `GET /v1/cashflow` (every sum, the rates and
 * the counters come from it; the web adds and divides no money), `GET /v1/goals` and `GET /v1/accounts` (names only:
 * the goals of «Внески в цілі», the loans without a rate, the brokerage accounts that show the investments row).
 */
export type Cashflow = Json<operations["getCashflow"]>;
export type FlowMonth = Cashflow["months"][number];
export type Money = FlowMonth["income"];

/** FR 1: the types of the period picker; «Власний» is not offered. */
export { TYPES };
export type { PeriodType };

export interface FlowState {
  readonly type: PeriodType;
  /** month `2026-10`, quarter `2026-Q4`, ytd and year `2026`. */
  readonly period: string;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const QUARTER = /^\d{4}-Q[1-4]$/;
const YEAR = /^\d{4}$/;
const valid = (type: PeriodType, period: string): boolean =>
  type === "month" ? MONTH.test(period) : type === "quarter" ? QUARTER.test(period) : YEAR.test(period);

/** CMP-72 «Стани»: the month in progress, as the other tabs of «Бюджет» open. */
export const defaultState = (today: string): FlowState => ({ type: "month", period: monthOf(today) });

/** `#/planning/budget/money-flow?type=quarter&period=2026-Q3` (the address keeps the choice). */
export function stateFromHash(hash: string, today: string): FlowState {
  const at = hash.indexOf("?");
  const q = new URLSearchParams(at < 0 ? "" : hash.slice(at + 1));
  const dflt = defaultState(today);
  const type = TYPES.find((x) => x === q.get("type")) ?? dflt.type;
  const period = q.get("period") ?? "";
  return {
    type,
    period: valid(type, period)
      ? period
      : type === dflt.type
        ? dflt.period
        : anchorTo(type, dflt.type, dflt.period, today),
  };
}

export function hashOf(path: string, s: FlowState): string {
  return `${path}?${new URLSearchParams({ type: s.type, period: s.period }).toString()}`;
}

export interface FlowData {
  readonly report: Cashflow;
  /** The names of the goals by id (BUD-05); a goal that is gone is shown by no name. */
  readonly goals: ReadonlyMap<string, string>;
  /** The names of the loans by id, for «внести ставку». */
  readonly accounts: ReadonlyMap<string, string>;
  /**
   * Owner decision 2026-11-20 (item 1): the row «Внески в інвестиції» is hidden until the space has a brokerage
   * account (the API may still send a zero field).
   */
  readonly hasBrokerage: boolean;
}

/** The kinds of account that are brokerage (investment) ones; the API's list of kinds has none yet (FIN-01@PoC FR 2). */
const BROKERAGE_KINDS: readonly string[] = ["brokerage", "investment", "pension"];

export async function loadFlow(api: ApiClient, s: FlowState): Promise<Load<FlowData>> {
  const [report, goals, accounts] = await Promise.all([
    outcome(api.GET("/v1/cashflow", { params: { query: { type: s.type, period: s.period } } })),
    outcome(api.GET("/v1/goals")),
    outcome(api.GET("/v1/accounts")),
  ]);
  if (!report.ok) return { state: "error", failure: report };
  // The names are only labels: when a list fails the screen still shows the numbers.
  const items = accounts.ok ? accounts.data.items : [];
  return {
    state: "ready",
    data: {
      report: report.data,
      goals: new Map((goals.ok ? goals.data.goals : []).map((g) => [g.id, g.name])),
      accounts: new Map(items.map((a) => [a.id, a.name])),
      hasBrokerage: items.some((a) => a.status === "active" && BROKERAGE_KINDS.includes(String(a.kind))),
    },
  };
}

/** The month of a period that is highest or lowest by `pick` (the first of equal ones); `null` below two values. */
export function extremesBy(
  months: readonly FlowMonth[],
  pick: (m: FlowMonth) => string | null,
): { high: FlowMonth; low: FlowMonth } | null {
  const with_ = months.filter((m) => pick(m) !== null);
  if (with_.length < 2) return null;
  let high = with_[0]!;
  let low = with_[0]!;
  for (const m of with_) {
    if (new Decimal(pick(m)!).gt(pick(high)!)) high = m;
    if (new Decimal(pick(m)!).lt(pick(low)!)) low = m;
  }
  return { high, low };
}

/** `true` when the amount is below zero (the screen explains a negative «Залишилось на рахунках»). */
export const isNegative = (m: Money): boolean => new Decimal(m.amount).lt(0);
/** `true` when the amount is not zero. */
export const isNonZero = (m: Money): boolean => !new Decimal(m.amount).isZero();
