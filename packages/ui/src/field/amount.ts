import { formatLocaleOf, type Locale } from "@willowsum/i18n";

/**
 * CMP-02@PoC «Вміст», «Довгі значення»: the text of an amount field and back. Amounts stay decimal strings
 * («4512300000.00») from the first key press to the consumer — never JS numbers (AGENTS.md money rule);
 * `Intl.NumberFormat` formats a decimal string exactly.
 */

/** `Intl.NumberFormat` accepts decimal strings; its TypeScript types still say `number`. */
type DecimalString = `${number}`;
const MINUS = "\u2212";
const SPACES = /[\s\u00A0\u202F]/g;
const SPACE = /^[\s\u00A0\u202F]$/;

/** The digits after the point a currency has (ISO 4217 minor units from `Intl`): EUR, UAH 2; JPY 0. */
export function currencyPlaces(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

function separatorsOf(locale: Locale): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(formatLocaleOf(locale)).formatToParts(12345.6);
  return {
    decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
    group: parts.find((p) => p.type === "group")?.value ?? ",",
  };
}

export type AmountProblem = "invalid" | "places";
export type ParsedAmount = { value: string | null; problem: null } | { value: null; problem: AmountProblem };

/**
 * What the user typed → a decimal string padded to the currency's digits («12,3» → «12.30»). Spaces and the
 * group separator of the language are ignored; the decimal separator of the language is the point, and in a
 * language with a decimal comma a point is read as one too («12.3» in uk). More significant digits after the
 * point than the currency has is the «places» problem (AC2): the field never rounds an entered amount away.
 * An empty text is no value.
 */
export function parseAmountInput(text: string, locale: Locale, places: number): ParsedAmount {
  const { decimal, group } = separatorsOf(locale);
  let s = text.replace(SPACES, "").replace(new RegExp(`[${MINUS}\u2012\u2013]`, "g"), "-");
  if (s === "") return { value: null, problem: null };
  if (group !== decimal && !SPACE.test(group) && s.includes(group)) {
    // «1,234.5» in en; «12,50» or «1,2,3» is not a grouped number and never becomes 1250 or 123.
    const [whole = "", ...fraction] = s.split(decimal);
    const g = group.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (fraction.some((f) => f.includes(group)) || !new RegExp(`^-?\\d{1,3}(?:${g}\\d{3})+$`).test(whole))
      return { value: null, problem: "invalid" };
    s = s.split(group).join("");
  }
  if (decimal !== ".") s = s.split(decimal).join(".");
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(s) ?? /^(-?)()\.(\d+)$/.exec(s);
  if (!m) return { value: null, problem: "invalid" };
  const sign = m[1] ?? "";
  const int = (m[2] ?? "").replace(/^0+(?=\d)/, "") || "0";
  const frac = (m[3] ?? "").replace(/0+$/, "");
  if (frac.length > places) return { value: null, problem: "places" };
  const value = places > 0 ? `${int}.${frac.padEnd(places, "0")}` : int;
  return { value: /^0(\.0*)?$/.test(value) ? value : `${sign}${value}`, problem: null };
}

const format = (locale: Locale, value: string, min: number, max: number) =>
  new Intl.NumberFormat(formatLocaleOf(locale), {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    roundingMode: "halfExpand",
  })
    .format(value as DecimalString)
    .replace(/-/g, MINUS);

/** Digits after the point that are not trailing zeros. */
const significantPlaces = (value: string) => (value.split(".")[1] ?? "").replace(/0+$/, "").length;

/**
 * The text of a field that is not being edited: the amount with the currency's digits and the language's
 * grouping («4 512 300 000,00»); a value with more digits than that is
 * rounded and flagged `approx`, and the field shows it with «≈» («≈ 0,33»).
 */
export function displayAmount(
  locale: Locale,
  value: string,
  places: number,
): { text: string; approx: boolean } {
  const approx = significantPlaces(value) > places;
  const text = format(locale, value, places, places);
  return { text, approx };
}

/** The text to edit when the field takes the focus: every digit of the value, nothing rounded. */
export function editAmount(locale: Locale, value: string, places: number): string {
  return format(locale, value, places, Math.max(places, significantPlaces(value)));
}
