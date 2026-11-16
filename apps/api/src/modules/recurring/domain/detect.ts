import { Decimal, Money, currencyInfo } from "@willowsum/domain-kernel";
import { FREQUENCIES, FREQUENCY_RULES, intervalFits, type Frequency } from "./schedule.ts";

/**
 * The detection of regular payments (BUD-07@PoC FR 2, FR 3, AC1, AC6, edge case «Сума змінна»; wave 2 row 25): the
 * series among the charges of one merchant in one direction and one currency. Pure and deterministic: the same charges
 * always give the same series.
 */

/** A charge as the detection reads it: the magnitude of the amount, in the group's one currency. */
export interface Charge {
  readonly id: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** Positive: an expense's or an income's amount without its sign. */
  readonly amount: Money;
}

export interface Series {
  readonly frequency: Frequency;
  /** FR 3: «змінна» — the amounts differ by more than ± 10 % but the largest is at most 2,5 × the smallest. */
  readonly variable: boolean;
  /** The charges of the series, oldest first. */
  readonly charges: readonly Charge[];
  /**
   * The expected amount: the latest charge's for a fixed series (the current price); the average of the last 3 for a
   * variable one (edge case «Сума змінна»), to the currency's minor units, half to even.
   */
  readonly expected: Money;
}

/** FR 2 «сума в межах ± 10 %»: every amount within 10 % of the series' median amount. */
export const FIXED_TOLERANCE = { low: new Decimal("0.9"), high: new Decimal("1.1") };
/** FR 3: a variable series — the largest ÷ the smallest ≤ 2,5. */
export const VARIABLE_RATIO = new Decimal("2.5");
/** How many of the latest charges a variable series' expected amount is the average of. */
export const VARIABLE_AVERAGE_OF = 3;

const byDate = (a: Charge, b: Charge) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1);

function bounds(charges: readonly Charge[]): { readonly min: Decimal; readonly max: Decimal } {
  let min = charges[0]!.amount.amount;
  let max = min;
  for (const c of charges) {
    if (c.amount.amount.lessThan(min)) min = c.amount.amount;
    if (c.amount.amount.greaterThan(max)) max = c.amount.amount;
  }
  return { min, max };
}

/** The median amount (of an even count, the average of the two middle ones). */
function median(charges: readonly Charge[]): Decimal {
  const sorted = charges.map((c) => c.amount.amount).sort((x, y) => x.comparedTo(y));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : sorted[mid - 1]!.plus(sorted[mid]!).div(2);
}

/** FR 2: the amounts are one price — each within ± 10 % of their median. */
export function withinTolerance(charges: readonly Charge[]): boolean {
  const { min, max } = bounds(charges);
  const m = median(charges);
  return (
    min.greaterThanOrEqualTo(m.times(FIXED_TOLERANCE.low)) &&
    max.lessThanOrEqualTo(m.times(FIXED_TOLERANCE.high))
  );
}

/** FR 3: the amounts may vary as a variable series' do. */
export function withinVariableRatio(charges: readonly Charge[]): boolean {
  const { min, max } = bounds(charges);
  return max.lessThanOrEqualTo(min.times(VARIABLE_RATIO));
}

interface Run {
  readonly frequency: Frequency;
  readonly charges: readonly Charge[];
}

/** The later run: the latest last charge, then the longer, then the shorter frequency. */
function better(a: Run, b: Run | null): boolean {
  if (b === null) return true;
  const [ae, be] = [a.charges.at(-1)!, b.charges.at(-1)!];
  if (ae.date !== be.date) return ae.date > be.date;
  if (a.charges.length !== b.charges.length) return a.charges.length > b.charges.length;
  return FREQUENCIES.indexOf(a.frequency) < FREQUENCIES.indexOf(b.frequency);
}

/**
 * FR 2: the series of `charges` (oldest first) — a run of consecutive charges whose every interval fits one frequency,
 * with at least its fewest charges and amounts that `accept` takes. A run whose amounts it refuses loses its oldest
 * charges until they fit. Consecutive, so a merchant paid every day never makes a monthly series of some of its days.
 */
function bestRun(charges: readonly Charge[], accept: (run: readonly Charge[]) => boolean): Run | null {
  let best: Run | null = null;
  for (const frequency of FREQUENCIES) {
    const min = FREQUENCY_RULES[frequency].minCharges;
    let start = 0;
    for (let i = 1; i <= charges.length; i += 1) {
      if (i < charges.length && intervalFits(charges[i - 1]!.date, charges[i]!.date, frequency)) continue;
      for (let from = start; i - from >= min; from += 1) {
        const run = charges.slice(from, i);
        if (!accept(run)) continue;
        const candidate = { frequency, charges: run };
        if (better(candidate, best)) best = candidate;
        break;
      }
      start = i;
    }
  }
  return best;
}

/** FR 3: the charges by price — runs of the amounts in order that stay within ± 10 % of their median. */
function priceGroups(charges: readonly Charge[]): Charge[][] {
  const sorted = [...charges].sort((a, b) => a.amount.amount.comparedTo(b.amount.amount) || byDate(a, b));
  const groups: Charge[][] = [];
  for (const c of sorted) {
    const last = groups.at(-1);
    if (last && withinTolerance([...last, c])) last.push(c);
    else groups.push([c]);
  }
  return groups.map((g) => g.sort(byDate));
}

const overlap = (a: Run, b: Run) =>
  a.charges[0]!.date <= b.charges.at(-1)!.date && b.charges[0]!.date <= a.charges.at(-1)!.date;

function series(run: Run, variable: boolean): Series {
  const latest = run.charges.at(-1)!.amount;
  if (!variable) return { frequency: run.frequency, variable, charges: run.charges, expected: latest };
  const last = run.charges.slice(-VARIABLE_AVERAGE_OF);
  const sum = last.reduce((total, c) => total.plus(c.amount.amount), new Decimal("0"));
  const average = sum
    .div(last.length)
    .toDecimalPlaces(currencyInfo(latest.currency).minorUnits, Decimal.ROUND_HALF_EVEN);
  return {
    frequency: run.frequency,
    variable,
    charges: run.charges,
    expected: Money.of(average, latest.currency),
  };
}

/**
 * FR 2, FR 3: the series among the charges of one merchant, one direction and one currency.
 *
 * 1. All the charges as one series — at one price (± 10 %): that series.
 * 2. Else by price: two series at different prices at the same time (FR 3 «кілька серій одного мерчанта з різними
 *    цінами») — each, with any later one.
 * 3. Else the current price with a series of its own (a price that went up and has charged long enough): that one.
 * 4. Else all the charges as one variable series (largest ≤ 2,5 × smallest).
 * 5. Else the latest series at one price.
 */
export function detectSeries(charges: readonly Charge[]): readonly Series[] {
  if (charges.length === 0) return [];
  const sorted = [...charges].sort(byDate);
  const whole = bestRun(sorted, withinVariableRatio);
  if (whole && withinTolerance(whole.charges)) return [series(whole, false)];
  const fixed = priceGroups(sorted)
    .map((g) => bestRun(g, withinTolerance))
    .filter((r): r is Run => r !== null);
  let latest: Run | null = null;
  for (const r of fixed) if (better(r, latest)) latest = r;
  const parallel = fixed.filter((a) => a === latest || fixed.some((b) => b !== a && overlap(a, b)));
  if (parallel.length > 1)
    return parallel.sort((a, b) => byDate(a.charges[0]!, b.charges[0]!)).map((r) => series(r, false));
  if (latest && latest.charges.at(-1) === sorted.at(-1)) return [series(latest, false)];
  if (whole) return [series(whole, true)];
  return latest ? [series(latest, false)] : [];
}
