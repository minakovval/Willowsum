import type { Locale } from "@willowsum/i18n";

/**
 * CMP-07 «Великі значення», DS-04 item 11: the abbreviated form of an amount. Pure string arithmetic
 * on the decimal value (no floating point, AGENTS.md money rule). The units follow the interface
 * language: uk — тис., млн, млрд, трлн, квдрлн, квінтлн; en — k, M, bn, tn, qd, qn. Above 999 of the
 * largest unit — «999+ квінтлн» / «999+ qn». Two decimals below 100 and one from 100 (12,35 трлн;
 * 128,4 тис.). The layout follows the interface language too (owner decision of 2026-11-05):
 * uk — decimal comma, the minus in front, the currency symbol after the unit, no-break spaces between
 * the parts: «128,4 тис. €», «−1,24 млн ₴»; en — the currency symbol first, decimal point, no spaces:
 * «€128.4k», «−€1.24M» (a letter code keeps a no-break space: «CHF 128.4k»). The minus is always
 * U+2212.
 */
const COMPACT_UNITS: Record<Locale, readonly string[]> = {
  uk: ["", "тис.", "млн", "млрд", "трлн", "квдрлн", "квінтлн"],
  en: ["", "k", "M", "bn", "tn", "qd", "qn"],
};
/** Units per language: none, thousand, million, billion, trillion, quadrillion, quintillion. */
const UNIT_COUNT = 7;
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
  /** Currency symbol or code, e.g. "€", "₴", "UAH". */
  currency: string;
  /** Interface language; picks the unit names. */
  locale: Locale;
}

/** «12,35 трлн €» (uk) or «€12.35tn» (en) style string, or null when the amount is below 1 000 and needs no abbreviation. */
export function formatCompactAmount({ value, currency, locale }: CompactInput): string | null {
  const units = COMPACT_UNITS[locale];
  const top = units[UNIT_COUNT - 1] ?? "";
  const show = (sign: string, int: string, frac: string, unit: string) =>
    locale === "en"
      ? `${sign}${currency}${/[A-Za-z]$/.test(currency) ? NBSP : ""}${frac ? `${int}.${frac}` : int}${unit}`
      : `${sign}${frac ? `${int},${frac}` : int}${NBSP}${unit}${NBSP}${currency}`;
  // Only a plain decimal string is accepted; anything else (spaces, grouping, exponents) gives null.
  if (!/^[-+]?\d+(\.\d+)?$/.test(value.trim())) return null;
  const negative = value.trim().startsWith("-");
  const [rawInt = "0", rawFrac = ""] = value.trim().replace(/^[-+]/, "").split(".");
  const intPart = rawInt.replace(/^0+(?=\d)/, "");
  if (intPart.length <= 3) return null;
  let unit = Math.min(Math.floor((intPart.length - 1) / 3), UNIT_COUNT - 1);
  const sign = negative ? MINUS : "";
  if (intPart.length > 3 * (UNIT_COUNT - 1) + 3) return show(sign, "999+", "", top);
  const split = intPart.length - unit * 3;
  let head = intPart.slice(0, split);
  let tail = intPart.slice(split) + rawFrac;
  let places = head.length >= 3 ? 1 : 2;
  let r = roundDecimal(head, tail, places);
  // Rounding can carry into a new thousand (999,96 k → 1,00 M).
  if (r.int.length > 3 && unit < UNIT_COUNT - 1) {
    unit += 1;
    head = intPart.slice(0, split - 3) || "0";
    tail = intPart.slice(Math.max(split - 3, 0)) + rawFrac;
    places = 2;
    r = roundDecimal(head, tail, places);
  }
  // Rounding up to 100 must switch to one decimal (99,995 k → 100,0 k).
  if (r.int.length === 3 && places === 2) {
    places = 1;
    r = roundDecimal(head, tail, places);
  }
  if (r.int.length > 3) return show(sign, "999+", "", top);
  return show(sign, r.int, r.frac, units[unit] ?? "");
}
