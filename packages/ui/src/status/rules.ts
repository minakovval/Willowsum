/**
 * The display rules of the status dictionary (DS-23@PoC FR 3–5). Pure functions of numbers that are already
 * known: no money is computed here, the caller passes the sums in the same unit (minor units or whole currency
 * units, the ratio does not change).
 */

export type UsageState = "notStarted" | "remaining" | "almost" | "limitReached" | "exhausted" | "over";

/** The share of the limit that is spent, in percent (not rounded). */
export function usagePercent(spent: number, limit: number): number {
  return (spent / limit) * 100;
}

/**
 * Family А (DS-23 «Шкала використання ліміту»): spent 0 → «не почато»; below 80 % → «є залишок»; from 80 % to
 * below 100 % → «майже вичерпано»; exactly 100 % → «ліміт вичерпано» of a mandatory category and «вичерпано» of an
 * optional one; above 100 % → «перевищено». A limit of zero or less has no scale («Поза планом»), so it throws.
 */
export function usageState(spent: number, limit: number, mandatory: boolean): UsageState {
  if (!(limit > 0))
    throw new RangeError("A limit of zero or less has no usage scale (the category is «Поза планом»)");
  if (spent <= 0) return "notStarted";
  if (spent > limit) return "over";
  if (spent === limit) return mandatory ? "limitReached" : "exhausted";
  return usagePercent(spent, limit) < 80 ? "remaining" : "almost";
}

/**
 * The percent shown in «майже вичерпано · N %»: a whole number that never reaches 100 while the state is not
 * yet «вичерпано» (99,6 % is shown as 99 %).
 */
export function almostPercent(spent: number, limit: number): number {
  return Math.min(99, Math.round(usagePercent(spent, limit)));
}

/** The level of an overspend, 1–8 (DS-23 FR 4): the share of the overspend in the optional limits of the period. */
export type OverLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const OVER_BOUNDS = [5, 10, 20, 50, 100, 200, 500] as const;

/**
 * Level 1 — below 5 %, 2 — from 5 % to 10 %, 3 — from 10 % to 20 %, 4 — from 20 % to 50 %, 5 — from 50 % to 100 %,
 * 6 — from 100 % to 200 %, 7 — from 200 % to 500 %, 8 — from 500 %; without optional limits — 8. A bound belongs
 * to the higher level.
 */
export function overLevel(overspend: number, optionalLimits: number): OverLevel {
  if (!(optionalLimits > 0)) return 8;
  const share = (overspend / optionalLimits) * 100;
  const below = OVER_BOUNDS.findIndex((bound) => share < bound);
  return (below === -1 ? 8 : below + 1) as OverLevel;
}

const USAGE_STOPS = [
  [0, "usage-0"],
  [30, "usage-30"],
  [55, "usage-55"],
  [75, "usage-75"],
  [95, "usage-95"],
] as const;

/**
 * The fill of a bar below 100 % (DS-23 FR 4): the continuous gradient `usage-0` … `usage-95`, interpolated in
 * OKLCH at the point of the percent; from 95 % the last stop. A CSS colour made of tokens only.
 */
export function usageFill(percent: number): string {
  const p = Math.min(100, Math.max(0, percent));
  for (let i = 1; i < USAGE_STOPS.length; i++) {
    const [to, toName] = USAGE_STOPS[i]!;
    const [from, fromName] = USAGE_STOPS[i - 1]!;
    if (p <= to) {
      const share = Math.round(((p - from) / (to - from)) * 1000) / 10;
      return `color-mix(in oklch, var(--ws-${toName}) ${share}%, var(--ws-${fromName}))`;
    }
  }
  return "var(--ws-usage-95)";
}

export type DeviationState = "better" | "slightlyBetter" | "unchanged" | "slightlyWorse" | "worse";

export interface Deviation {
  state: DeviationState;
  /** The arrow follows the sign of the change, the colour follows «краще» / «гірше». */
  arrow: "▲" | "▼" | null;
  /** The percent as the user sees it, one digit after the comma, or `null` when the base is zero. */
  percent: number | null;
}

/**
 * Family Б (DS-23 FR 5): `value` against `base`. `kind` says what is better: less spending or debt, more income.
 * «Без змін» — the change is below 1 % and below 1 currency unit. Up to 10 % inclusive — the soft step; the 10 %
 * bound is compared with the percent rounded to one digit (10,04 % is «10,0 %»: still soft).
 */
export function deviation(value: number, base: number, kind: "expense" | "income"): Deviation {
  const change = value - base;
  const percent = base === 0 ? null : Math.round((Math.abs(change) / Math.abs(base)) * 1000) / 10;
  const rawPercent = base === 0 ? Infinity : (Math.abs(change) / Math.abs(base)) * 100;
  if (rawPercent < 1 && Math.abs(change) < 1) return { state: "unchanged", arrow: null, percent };
  const better = kind === "income" ? change > 0 : change < 0;
  const soft = percent !== null && percent <= 10;
  const state: DeviationState = better
    ? soft
      ? "slightlyBetter"
      : "better"
    : soft
      ? "slightlyWorse"
      : "worse";
  return { state, arrow: change > 0 ? "▲" : "▼", percent };
}
