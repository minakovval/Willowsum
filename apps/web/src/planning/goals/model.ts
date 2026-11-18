import type { ApiClient, operations } from "@willowsum/api-contract";
import { Decimal, Money as KernelMoney, sumMoney } from "@willowsum/domain-kernel";
import { outcome } from "../../auth/api.ts";
import { loadAccounts, type AccountLabel, type Load } from "../../recurring/data.ts";

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

/**
 * BUD-05@PoC c) (wave 2, row 128): what S-136 «Цілі» and the card S-137 read — `GET /v1/goals` (the space's goals with
 * collected, progress, the required monthly contribution, the pace and the forecast; the amounts are shown as the API
 * gives them) and the accounts for the names of the parts («Резерв ПриватБанк ··5562»).
 */
export type Goal = Json<operations["listGoals"]>["goals"][number];
export type Money = Goal["target"];
export type PartKind = Goal["part"]["kind"];

export interface GoalsData {
  readonly goals: readonly Goal[];
  readonly accounts: ReadonlyMap<string, AccountLabel>;
}

export async function loadGoals(api: ApiClient): Promise<Load<GoalsData>> {
  const [goals, accounts] = await Promise.all([outcome(api.GET("/v1/goals")), loadAccounts(api)]);
  if (!goals.ok) return { state: "error", failure: goals };
  return { state: "ready", data: { goals: goals.data.goals, accounts } };
}

/**
 * The sum shown in the header of the list. Goals in several currencies have no honest sum without a dated rate, so the
 * guard returns `null` and the header names only the count. A client sum: the API has none yet (follow-up for it).
 */
export function collectedTotal(goals: readonly Goal[]): Money | null {
  const [first] = goals;
  if (first === undefined) return null;
  const currency = first.collected.currency;
  if (goals.some((g) => g.collected.currency !== currency)) return null;
  try {
    return sumMoney(
      goals.map((g) => KernelMoney.of(g.collected.amount, g.collected.currency)),
      currency,
    ).toJSON();
  } catch {
    return null;
  }
}

/** The share of the target as the API gives it («52.5»), kept within 0 … 100 for the bar. */
export function barPercent(progressPercent: string): Decimal {
  const value = new Decimal(progressPercent);
  return value.isFinite() ? Decimal.min(100, Decimal.max(0, value)) : new Decimal("0");
}

const STOPS = [
  [0, "goal-0"],
  [25, "goal-25"],
  [55, "goal-55"],
  [80, "goal-80"],
  [100, "goal-100"],
] as const;

/**
 * BUD-05@PoC FR 4, GRID-04@PoC FR 7: the colour of the bar is the point of the goal progress scale (`goal-0` …
 * `goal-100`) at the fill percent — a mix of the two neighbouring stops; an achieved goal and a goal over the target
 * (100 % and more) get `goal-100`.
 */
export function goalColor(percent: Decimal): string {
  const p = Decimal.min(100, Decimal.max(0, percent));
  for (let i = 1; i < STOPS.length; i++) {
    const [to, toName] = STOPS[i]!;
    const [from, fromName] = STOPS[i - 1]!;
    if (p.lte(to)) {
      const share = p
        .minus(from)
        .div(to - from)
        .times(100)
        .toDecimalPlaces(0);
      return share.isZero()
        ? `var(--ws-${fromName})`
        : share.gte(100)
          ? `var(--ws-${toName})`
          : `color-mix(in srgb, var(--ws-${toName}) ${share.toString()}%, var(--ws-${fromName}))`;
    }
  }
  return "var(--ws-goal-100)";
}

/** `#/planning/goals?goal=<id>`: the goal of the card next to the list, or `null` for the first one. */
export function goalFromHash(hash: string): string | null {
  const at = hash.indexOf("?");
  return at < 0 ? null : new URLSearchParams(hash.slice(at + 1)).get("goal");
}

/** The sum after a contribution, for the line under the form: a client calculation, one currency only. */
export function afterContribution(goal: Goal, amount: string): { collected: Money; percent: string } | null {
  try {
    const added = new Decimal(amount);
    const target = new Decimal(goal.target.amount);
    if (!added.isFinite() || added.lt(0) || !target.gt(0)) return null;
    const collected = KernelMoney.of(goal.collected.amount, goal.collected.currency).plus(
      KernelMoney.of(added, goal.collected.currency),
    );
    return {
      collected: collected.toJSON(),
      percent: collected.amount.div(target).times(100).toDecimalPlaces(0, Decimal.ROUND_DOWN).toString(),
    };
  } catch {
    return null;
  }
}
