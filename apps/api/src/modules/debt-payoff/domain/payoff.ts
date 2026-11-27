import { AmountOutOfRangeError, currencyInfo, Decimal, Money } from "@willowsum/domain-kernel";

/**
 * Debt payoff (BUD-19@PoC FR 3, FR 4, FR 6, FR 7; wave 2 row 33): the month-by-month calculation of one debt and of all
 * debts under a strategy, and the progress against a saved plan. Pure rules, no I/O; every amount is Money in the debt's
 * currency (never a float). Each month: interest = balance × annual rate ÷ 12, rounded to the currency's minor unit
 * half to even (banker's rounding; FR 3, owner decision 2026-11-16), then the payment is taken; the last payment is
 * the balance with its interest, so it may be smaller.
 */

/** The upper bound of a calculation (FR 3, edge case 6): 1 200 months — «Розрахунок перевищує 100 років». */
export const MONTHS_MAX = 1200;
/** At most this many one-off payments in a scenario (lead decision). */
export const ONE_OFFS_MAX = 24;
export const STRATEGIES = ["avalanche", "snowball"] as const;
export type Strategy = (typeof STRATEGIES)[number];

/** YYYY-MM. Month 1 of a calculation is the month after the current one (lead decision). */
export type Month = string;

export function addMonths(month: Month, n: number): Month {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Months from `from` to `to` (positive when `to` is later). */
export function monthsBetween(from: Month, to: Month): number {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return ty * 12 + tm - (fy * 12 + fm);
}

/**
 * One month's interest (FR 3, FR 12): balance × rate ÷ 100 ÷ 12, to the minor unit, half to even (banker's rounding;
 * owner decision 2026-11-16, #419). The one rounding of the schedule: balances, payments and totals are sums of
 * already-rounded amounts.
 */
export function monthlyInterest(balance: Money, annualRate: string): Money {
  const raw = balance.amount.times(new Decimal(annualRate)).dividedBy(1200);
  return Money.of(
    raw.toDecimalPlaces(currencyInfo(balance.currency).minorUnits, Decimal.ROUND_HALF_EVEN),
    balance.currency,
  );
}

const min = (a: Money, b: Money) => (a.compare(b) <= 0 ? a : b);
const positive = (m: Money) => !m.isZero() && !m.isNegative();

/** What a calculation assumes (FR 2): from the liability, or overridden in the scenario only. */
export interface Assumptions {
  readonly balance: Money;
  readonly annualRate: string;
  readonly monthlyPayment: Money;
  /** «Додатковий платіж / міс.» (FR 4); zero in the base scenario. */
  readonly extraMonthly: Money;
  /** «Додати разовий платіж» (FR 4): each in its month (1 = the month after the current one). */
  readonly oneOffs: readonly { readonly month: number; readonly amount: Money }[];
}

export type Outcome<T> =
  /** FR 3, edge case 1: the payment does not exceed the month's interest — «За цих умов борг не зменшується». */
  | { readonly kind: "not-decreasing" }
  /** Edge case 6: longer than 1 200 months — «Розрахунок перевищує 100 років — збільште платіж». */
  | { readonly kind: "over-limit" }
  | ({ readonly kind: "paid" } & T);

export interface PayoffResult {
  /** «Погашення через N міс.» */
  readonly months: number;
  /** «Відсотки за весь строк». */
  readonly totalInterest: Money;
  /** The balance at the end of each month 1…months (the last is zero): the chart and its table (FR 10). */
  readonly balances: readonly Money[];
  /** Edge case 5: the one-offs larger than the balance left, by their month — each was capped to it. */
  readonly cappedOneOffs: readonly number[];
}

/**
 * Edge case 6: amounts the calculation cannot hold (NUMERIC(38,18): a balance with its interest, the payments' sum or
 * the interest over the term past 20 integer digits) are «Розрахунок перевищує 100 років — збільште платіж», not a 500.
 */
function bounded<T>(run: () => Outcome<T>): Outcome<T> {
  try {
    return run();
  } catch (error) {
    if (error instanceof AmountOutOfRangeError) return { kind: "over-limit" };
    throw error;
  }
}

/** One debt month by month (FR 3, FR 4). */
export function simulate(a: Assumptions): Outcome<PayoffResult> {
  return bounded(() => simulateUnbounded(a));
}

function simulateUnbounded(a: Assumptions): Outcome<PayoffResult> {
  let balance = a.balance;
  const currency = balance.currency;
  if (!positive(balance))
    return { kind: "paid", months: 0, totalInterest: Money.zero(currency), balances: [], cappedOneOffs: [] };
  const payment = a.monthlyPayment.plus(a.extraMonthly);
  if (payment.compare(monthlyInterest(balance, a.annualRate)) <= 0) return { kind: "not-decreasing" };
  let interest = Money.zero(currency);
  const balances: Money[] = [];
  const capped: number[] = [];
  for (let month = 1; month <= MONTHS_MAX; month++) {
    const i = monthlyInterest(balance, a.annualRate);
    interest = interest.plus(i);
    balance = balance.plus(i);
    balance = balance.minus(min(payment, balance));
    for (const o of a.oneOffs) {
      if (o.month !== month) continue;
      if (o.amount.compare(balance) > 0) capped.push(month);
      balance = balance.minus(min(o.amount, balance));
    }
    balances.push(balance);
    if (balance.isZero())
      return { kind: "paid", months: month, totalInterest: interest, balances, cappedOneOffs: capped };
  }
  return { kind: "over-limit" };
}

/**
 * A debt in «Стратегія» (FR 6): its fixed minimum payment. `annualRate` null — a credit card: no rate and no interest
 * (FLW-44@PoC FR 4, owner decision 2026-11-27); its payment is the user's «Зменшувати на … / міс.».
 */
export interface StrategyDebt {
  readonly id: string;
  readonly balance: Money;
  readonly annualRate: string | null;
  readonly minimumPayment: Money;
}

const interestOf = (d: { readonly left: Money; readonly annualRate: string | null }): Money =>
  d.annualRate === null ? Money.zero(d.left.currency) : monthlyInterest(d.left, d.annualRate);

/** Avalanche: the highest rate first; a debt without a rate (a credit card) after every rated one (FLW-44 FR 4). */
function byRate(
  x: { readonly annualRate: string | null },
  y: { readonly annualRate: string | null },
): number {
  if (x.annualRate === null || y.annualRate === null)
    return (x.annualRate === null ? 1 : 0) - (y.annualRate === null ? 1 : 0);
  return new Decimal(y.annualRate).comparedTo(new Decimal(x.annualRate));
}

export interface StrategyResult {
  /** All debts paid off after this many months. */
  readonly months: number;
  readonly totalInterest: Money;
  /** The month each debt is closed in, by debt id. */
  readonly closedIn: ReadonlyMap<string, number>;
}

/**
 * «Усього на борги / міс.» under a strategy (FR 6): each month every debt takes its interest, then its minimum
 * payment; what is left of the total goes to one debt — the highest rate first (Avalanche) or the smallest balance first
 * (Snowball; ties by the order given; a debt without a rate — after the rated ones in Avalanche, by its balance in
 * Snowball) — and on to the next when it is paid off. A paid-off debt's minimum stays in the
 * total, so it passes to the next one. `total` must cover the minimums (the caller checks it).
 */
export function simulateStrategy(
  debts: readonly StrategyDebt[],
  total: Money,
  strategy: Strategy,
): Outcome<StrategyResult> {
  return bounded(() => simulateStrategyUnbounded(debts, total, strategy));
}

function simulateStrategyUnbounded(
  debts: readonly StrategyDebt[],
  total: Money,
  strategy: Strategy,
): Outcome<StrategyResult> {
  const currency = total.currency;
  const live = debts.map((d, order) => ({ ...d, order, left: d.balance }));
  const firstInterest = live.reduce(
    (sum, d) => (positive(d.left) ? sum.plus(interestOf(d)) : sum),
    Money.zero(currency),
  );
  const closedIn = new Map<string, number>();
  for (const d of live) if (!positive(d.left)) closedIn.set(d.id, 0);
  if (closedIn.size === live.length)
    return { kind: "paid", months: 0, totalInterest: Money.zero(currency), closedIn };
  if (total.compare(firstInterest) <= 0) return { kind: "not-decreasing" };
  let interest = Money.zero(currency);
  for (let month = 1; month <= MONTHS_MAX; month++) {
    let available = total;
    const open = live.filter((d) => positive(d.left));
    for (const d of open) {
      const i = interestOf(d);
      interest = interest.plus(i);
      d.left = d.left.plus(i);
    }
    for (const d of open) {
      const paid = min(d.minimumPayment, d.left);
      d.left = d.left.minus(paid);
      available = available.minus(paid);
    }
    const targets = open
      .filter((d) => positive(d.left))
      .sort((x, y) =>
        strategy === "avalanche"
          ? byRate(x, y) || x.order - y.order
          : x.left.compare(y.left) || x.order - y.order,
      );
    for (const d of targets) {
      if (!positive(available)) break;
      const paid = min(available, d.left);
      d.left = d.left.minus(paid);
      available = available.minus(paid);
    }
    for (const d of open) if (d.left.isZero()) closedIn.set(d.id, month);
    if (closedIn.size === live.length)
      return { kind: "paid", months: month, totalInterest: interest, closedIn };
  }
  return { kind: "over-limit" };
}

/** «Погашено N %» (FR 7): the share paid of the start balance, rounded down to a whole percent; 0–100. */
export function paidPercent(start: Money, current: Money): number {
  if (!positive(start)) return 0;
  const left = current.isNegative() ? Money.zero(current.currency) : current;
  const share = start.minus(min(left, start)).amount.times(100).dividedBy(start.amount);
  return Number.parseInt(share.floor().toFixed(), 10);
}

export type PlanStatus = "ahead" | "on-track" | "behind";

/**
 * The «План» column (FR 7): what was paid off this month against what the saved plan pays off in it.
 * `plannedBefore`/`plannedAfter` — the plan's balances at the start and the end of this month; `actualBefore` — the
 * debt at the end of last month, `actualNow` — today's.
 */
export function planDeviation(
  plannedBefore: Money,
  plannedAfter: Money,
  actualBefore: Money,
  actualNow: Money,
): { readonly status: PlanStatus; readonly amount: Money } {
  const difference = actualBefore.minus(actualNow).minus(plannedBefore.minus(plannedAfter));
  if (difference.isZero()) return { status: "on-track", amount: difference };
  return difference.isNegative()
    ? { status: "behind", amount: difference.negated() }
    : { status: "ahead", amount: difference };
}
