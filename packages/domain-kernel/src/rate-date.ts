// Calendar-date rules shared by the modules that pick a rate for a date (fx-rates, the list totals of platform).

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 of a calendar date (YYYY-MM-DD); a day count, never an amount. */
function dayNumber(date: string): number {
  const m = ISO_DATE_RE.exec(date);
  if (!m) throw new Error("A date is YYYY-MM-DD");
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

/** Saturday or Sunday (1970-01-01 was a Thursday). */
function isWeekendDay(day: number): boolean {
  const weekday = (((day + 4) % 7) + 7) % 7; // 0 = Sunday
  return weekday === 0 || weekday === 6;
}

/**
 * Whether a rate of `rateDate` is the rate of `requestedDate` (business rules, AC4, edge case 1): the same date,
 * or a working day followed only by weekend days up to the requested date (a Saturday or Sunday takes the
 * previous working day's rate). Anything else — a working day without its rate, a holiday (no holiday calendar in
 * PoC), an older rate — is the nearest available rate and the amount is «приблизно» (edge case 3).
 */
export function rateCoversDate(rateDate: string, requestedDate: string): boolean {
  const from = dayNumber(rateDate);
  const to = dayNumber(requestedDate);
  if (from > to) return false;
  for (let day = from + 1; day <= to; day += 1) if (!isWeekendDay(day)) return false;
  return true;
}

/** A real calendar date written YYYY-MM-DD: not "today", not "2026-02-30". */
export function isCalendarDate(date: string): boolean {
  const m = ISO_DATE_RE.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === date;
}
