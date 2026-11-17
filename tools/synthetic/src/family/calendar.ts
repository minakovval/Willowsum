/** Calendar arithmetic on «YYYY-MM-DD» and «YYYY-MM-DD HH:MM:SS» strings (bank-local wall time, no time zone). */
const DAY_MS = 86_400_000;

export const pad2 = (n: number): string => String(n).padStart(2, "0");

function parts(isoDate: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`Not a date: ${isoDate}`);
  return [Number.parseInt(m[1]!, 10), Number.parseInt(m[2]!, 10), Number.parseInt(m[3]!, 10)];
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = parts(value);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Adds minutes to «YYYY-MM-DD HH:MM:SS». */
export function addMinutes(at: string, minutes: number): string {
  const iso = new Date(Date.parse(`${at.replace(" ", "T")}Z`) + minutes * 60_000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

export interface Month {
  readonly year: number;
  readonly month: number;
  /** «YYYY-MM». */
  readonly key: string;
  readonly days: number;
}

/** `count` calendar months from the month of `start` (which must be the 1st). */
export function months(start: string, count: number): Month[] {
  const [y0, m0] = parts(start);
  return Array.from({ length: count }, (_, i) => {
    const year = y0 + Math.floor((m0 - 1 + i) / 12);
    const month = ((m0 - 1 + i) % 12) + 1;
    return { year, month, key: `${year}-${pad2(month)}`, days: daysInMonth(year, month) };
  });
}

/** «YYYY-MM-DD» → «DD.MM.YYYY». */
export const dotted = (date: string): string => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
/** «YYYY-MM-DD» → «DD/MM/YYYY». */
export const slashed = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
