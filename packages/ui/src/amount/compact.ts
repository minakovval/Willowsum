/**
 * CMP-07 «Великі значення»: the abbreviated form of an amount. Pure string arithmetic on the decimal
 * value (no floating point, AGENTS.md money rule). Units: k, M, bn, tn, qd, qn; above 999 qn —
 * «999+ qn». Two decimals below 100 and one from 100 (12,35 tn; 128,4 k); decimal comma; the minus
 * and the currency stay in front: «−€ 12,3 bn».
 */
const UNITS = ["", "k", "M", "bn", "tn", "qd", "qn"] as const;
const MINUS = "−";
const NBSP = " ";

/** Round a non-negative decimal string to `places` decimals (half up). */
function roundDecimal(intPart: string, frac: string, places: number): { int: string; frac: string } {
  const digits = (intPart + frac.padEnd(places + 1, "0")).split("").map(Number);
  const keep = intPart.length + places;
  let carry = (digits[keep] ?? 0) >= 5 ? 1 : 0;
  const kept = digits.slice(0, keep);
  for (let i = kept.length - 1; i >= 0 && carry; i--) {
    const d = (kept[i] ?? 0) + carry;
    kept[i] = d % 10;
    carry = d >= 10 ? 1 : 0;
  }
  if (carry) kept.unshift(1);
  const intLen = kept.length - places;
  return { int: kept.slice(0, intLen).join(""), frac: kept.slice(intLen).join("") };
}

export interface CompactInput {
  /** Decimal amount as a string, e.g. "-12345678901234.00". */
  value: string;
  /** Currency symbol or code shown in front, e.g. "€", "₴", "UAH". */
  currency: string;
}

/** «€ 12,35 tn» style string, or null when the amount is below 1 000 and needs no abbreviation. */
export function formatCompactAmount({ value, currency }: CompactInput): string | null {
  const negative = value.trim().startsWith("-");
  const [rawInt = "0", rawFrac = ""] = value.trim().replace(/^[-+]/, "").split(".");
  const intPart = rawInt.replace(/^0+(?=\d)/, "");
  if (intPart.length <= 3) return null;
  let unit = Math.min(Math.floor((intPart.length - 1) / 3), UNITS.length - 1);
  const sign = negative ? MINUS : "";
  if (intPart.length > 3 * (UNITS.length - 1) + 3) return `${sign}${currency}${NBSP}999+${NBSP}qn`;
  const split = intPart.length - unit * 3;
  let head = intPart.slice(0, split);
  let tail = intPart.slice(split) + rawFrac;
  let places = head.length >= 3 ? 1 : 2;
  let r = roundDecimal(head, tail, places);
  // Rounding can carry into a new thousand (999,96 k → 1,00 M).
  if (r.int.length > 3 && unit < UNITS.length - 1) {
    unit += 1;
    head = intPart.slice(0, split - 3) || "0";
    tail = intPart.slice(Math.max(split - 3, 0)) + rawFrac;
    places = 2;
    r = roundDecimal(head, tail, places);
  }
  if (r.int.length > 3) return `${sign}${currency}${NBSP}999+${NBSP}qn`;
  return `${sign}${currency}${NBSP}${r.int},${r.frac}${NBSP}${UNITS[unit]}`;
}
