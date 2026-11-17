import { currencyInfo, Decimal } from "@willowsum/domain-kernel";

/**
 * The display rules of the status dictionary (DS-23@PoC FR 3–5). The amounts come in as exact decimals (a decimal
 * string or a `Decimal` of `@willowsum/domain-kernel`, never a float: AGENTS.md «Money», NFR-06) and are only
 * compared here, in the same currency; the sums themselves are decided by the budget module.
 */
export type DecimalInput = string | Decimal;

const dec = (value: DecimalInput): Decimal => new Decimal(value);

export type UsageState = "notStarted" | "remaining" | "almost" | "limitReached" | "exhausted" | "over";

/** The share of the limit that is spent, in percent (exact, not rounded). */
export function usagePercent(spent: DecimalInput, limit: DecimalInput): Decimal {
  return dec(spent).div(dec(limit)).times(100);
}

/**
 * Family А (DS-23 «Шкала використання ліміту»): spent 0 → «не почато»; below 80 % → «є залишок»; from 80 % to
 * below 100 % → «майже вичерпано»; exactly 100 % → «ліміт вичерпано» of a mandatory category and «вичерпано» of an
 * optional one; above 100 % → «перевищено». A limit of zero or less has no scale («Поза планом»), so it throws.
 */
export function usageState(spent: DecimalInput, limit: DecimalInput, mandatory: boolean): UsageState {
  const s = dec(spent);
  const l = dec(limit);
  if (!l.gt(0))
    throw new RangeError("A limit of zero or less has no usage scale (the category is «Поза планом»)");
  if (s.lte(0)) return "notStarted";
  if (s.gt(l)) return "over";
  if (s.eq(l)) return mandatory ? "limitReached" : "exhausted";
  return usagePercent(s, l).lt(80) ? "remaining" : "almost";
}

/**
 * The percent shown in «майже вичерпано · N %»: a whole number that never reaches 100 while the state is not
 * yet «вичерпано» (99,6 % is shown as 99 %).
 */
export function almostPercent(spent: DecimalInput, limit: DecimalInput): string {
  return Decimal.min(99, usagePercent(spent, limit).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)).toFixed(0);
}

/** The level of an overspend, 1–8 (DS-23 FR 4): the share of the overspend in the optional limits of the period. */
export type OverLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const OVER_BOUNDS = [5, 10, 20, 50, 100, 200, 500] as const;

/**
 * Level 1 — below 5 %, 2 — from 5 % to 10 %, 3 — from 10 % to 20 %, 4 — from 20 % to 50 %, 5 — from 50 % to 100 %,
 * 6 — from 100 % to 200 %, 7 — from 200 % to 500 %, 8 — from 500 %; without optional limits — 8. A bound belongs
 * to the higher level.
 */
export function overLevel(overspend: DecimalInput, optionalLimits: DecimalInput): OverLevel {
  const total = dec(optionalLimits);
  if (!total.gt(0)) return 8;
  const share = dec(overspend).div(total).times(100);
  const below = OVER_BOUNDS.findIndex((bound) => share.lt(bound));
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
export function usageFill(percent: DecimalInput): string {
  const p = Decimal.min(100, Decimal.max(0, dec(percent)));
  for (let i = 1; i < USAGE_STOPS.length; i++) {
    const [to, toName] = USAGE_STOPS[i]!;
    const [from, fromName] = USAGE_STOPS[i - 1]!;
    if (p.lte(to)) {
      const share = p
        .minus(from)
        .div(to - from)
        .times(100)
        .toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
      return `color-mix(in oklch, var(--ws-${toName}) ${share.toFixed()}%, var(--ws-${fromName}))`;
    }
  }
  return "var(--ws-usage-95)";
}

export type DeviationState = "better" | "slightlyBetter" | "unchanged" | "slightlyWorse" | "worse";

export interface Deviation {
  state: DeviationState;
  /** The arrow follows the sign of the change, the colour follows «краще» / «гірше». */
  arrow: "▲" | "▼" | null;
  /** The percent as the user sees it, one digit after the comma (a decimal string), or `null` when the base is zero. */
  percent: string | null;
}

/**
 * Family Б (DS-23 FR 5): `value` against `base`, both in `currency`. `kind` says what is better: less spending or
 * debt, more income. «Без змін» — the change is below 1 % and below 1 whole currency unit. Up to 10 % inclusive —
 * the soft step; the 10 % bound is compared with the percent rounded to one digit (10,04 % is «10,0 %»: still soft).
 */
export function deviation(
  value: DecimalInput,
  base: DecimalInput,
  kind: "expense" | "income",
  currency: string,
): Deviation {
  currencyInfo(currency); // an unknown currency is an error, not a guess
  const change = dec(value).minus(dec(base));
  const baseValue = dec(base);
  const rawPercent = baseValue.isZero() ? null : change.abs().div(baseValue.abs()).times(100);
  const percent = rawPercent ? rawPercent.toDecimalPlaces(1, Decimal.ROUND_HALF_UP) : null;
  if ((rawPercent === null ? false : rawPercent.lt(1)) && change.abs().lt(1))
    return { state: "unchanged", arrow: null, percent: percent?.toFixed(1) ?? null };
  if (change.isZero()) return { state: "unchanged", arrow: null, percent: percent?.toFixed(1) ?? null };
  const better = kind === "income" ? change.gt(0) : change.lt(0);
  const soft = percent !== null && percent.lte(10);
  const state: DeviationState = better
    ? soft
      ? "slightlyBetter"
      : "better"
    : soft
      ? "slightlyWorse"
      : "worse";
  return { state, arrow: change.gt(0) ? "▲" : "▼", percent: percent?.toFixed(1) ?? null };
}
