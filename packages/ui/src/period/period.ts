import { formatLocaleOf, type Locale } from "@willowsum/i18n";

/**
 * DS-04@PoC item 9: a period is a month and a year («жовт. 2026»), or a range with an en dash — no spaces between
 * the numbers of one month («1–31 жовт. 2026»), spaces around the dash between different months
 * («28 вер. – 4 жовт. 2026»). Calendar dates are read as written (`YYYY-MM-DD`, no time zone).
 */
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;

function monthShort(locale: Locale, year: number, month: number): string {
  const at = new Date(Date.UTC(year, month - 1, 1));
  const parts = new Intl.DateTimeFormat(formatLocaleOf(locale), {
    month: "short",
    timeZone: "UTC",
  }).formatToParts(at);
  return parts.find((p) => p.type === "month")?.value ?? "";
}

function parse(isoDate: string): { year: number; month: number; day: number } {
  const m = DATE.exec(isoDate);
  if (!m) throw new RangeError("Not a calendar date (YYYY-MM-DD)");
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day)
    throw new RangeError("No such calendar date");
  return { year, month, day };
}

/** A whole month «YYYY-MM»: «жовт. 2026» (uk), «Oct 2026» (en). */
export function formatPeriodMonth(locale: Locale, month: string): string {
  const m = MONTH.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new RangeError("Not a month (YYYY-MM)");
  return `${monthShort(locale, Number(m[1]), Number(m[2]))} ${m[1]}`;
}

/** A range of calendar dates, both ends included: «1–31 жовт. 2026», «28 вер. – 4 жовт. 2026», «30 груд. 2026 – 2 січ. 2027». */
export function formatPeriodRange(locale: Locale, from: string, to: string): string {
  const a = parse(from);
  const b = parse(to);
  if (from > to) throw new RangeError("The period ends before it starts");
  const ma = monthShort(locale, a.year, a.month);
  const mb = monthShort(locale, b.year, b.month);
  if (from === to) return `${a.day} ${ma} ${a.year}`;
  if (a.year === b.year && a.month === b.month) return `${a.day}–${b.day} ${ma} ${a.year}`;
  if (a.year === b.year) return `${a.day} ${ma} – ${b.day} ${mb} ${b.year}`;
  return `${a.day} ${ma} ${a.year} – ${b.day} ${mb} ${b.year}`;
}
