/**
 * The frequencies of a regular payment and its schedule (BUD-07@PoC FR 2, FR 6; wave 2 row 25): «тиждень, 2 тижні,
 * місяць, квартал, рік», the interval between two charges that fits each, the fewest charges a series needs, and the
 * next date of a schedule. Dates are calendar dates (`YYYY-MM-DD`).
 */
export const FREQUENCIES = ["week", "two-weeks", "month", "quarter", "year"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

interface Rule {
  /** FR 2: the interval between two charges of a series, in days, both ends included. */
  readonly minDays: number;
  readonly maxDays: number;
  /** FR 2: the fewest charges a series is proposed with. */
  readonly minCharges: number;
  /** One step of the schedule: days, or calendar months. */
  readonly step: { readonly days: number } | { readonly months: number };
}

export const FREQUENCY_RULES: Readonly<Record<Frequency, Rule>> = {
  week: { minDays: 6, maxDays: 8, minCharges: 3, step: { days: 7 } },
  "two-weeks": { minDays: 12, maxDays: 16, minCharges: 3, step: { days: 14 } },
  month: { minDays: 26, maxDays: 35, minCharges: 3, step: { months: 1 } },
  quarter: { minDays: 85, maxDays: 97, minCharges: 3, step: { months: 3 } },
  year: { minDays: 355, maxDays: 375, minCharges: 2, step: { months: 12 } },
};

const DAY_MS = 86_400_000;

/** The day `days` after a date (negative — before). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Days from one date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * The `k`-th date of the schedule anchored at `anchor` (k = 0 — the anchor). Months are counted from the anchor, never
 * from the date before, and a day the month lacks is its last day: anchored at 31 January — 28 (29) February, then
 * 31 March; anchored at 29 February — 28 February of the next year.
 */
export function scheduleDate(anchor: string, frequency: Frequency, k: number): string {
  const step = FREQUENCY_RULES[frequency].step;
  if ("days" in step) return addDays(anchor, step.days * k);
  const [y, m, d] = [Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), Number(anchor.slice(8, 10))];
  const first = new Date(Date.UTC(y, m - 1 + step.months * k, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

/**
 * «Наступна дата»: the first date of the schedule anchored at `anchor` that is on or after `from` (the anchor itself
 * when it is not before `from`).
 */
export function nextDate(anchor: string, frequency: Frequency, from: string): string {
  if (anchor >= from) return anchor;
  const step = FREQUENCY_RULES[frequency].step;
  const days = daysBetween(anchor, from);
  // A step is at least 28 days of months (or exactly its days), so this never passes the answer.
  let k = "days" in step ? Math.floor(days / step.days) : Math.floor(days / (31 * step.months));
  while (scheduleDate(anchor, frequency, k) < from) k += 1;
  return scheduleDate(anchor, frequency, k);
}

/** FR 2: whether the interval between two charges fits a frequency. */
export function intervalFits(from: string, to: string, frequency: Frequency): boolean {
  const days = daysBetween(from, to);
  const rule = FREQUENCY_RULES[frequency];
  return days >= rule.minDays && days <= rule.maxDays;
}
