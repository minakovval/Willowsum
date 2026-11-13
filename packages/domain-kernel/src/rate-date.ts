// Calendar-date check shared by the modules (no business rule: which rate covers a date is fx-rates' VAL-04 rule).

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A real calendar date written YYYY-MM-DD: not "today", not "2026-02-30". Years 0000–0099 are refused (`Date.UTC`
 * maps them to 1900–1999, so the round trip would not match).
 */
export function isCalendarDate(date: string): boolean {
  const m = ISO_DATE_RE.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === date;
}
