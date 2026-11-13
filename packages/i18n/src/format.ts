import { languageOf, type Locale } from "./languages.ts";

/**
 * NFR-09 FR 3, П-15: numbers, amounts, dates and time stamps formatted by the user's language (its regional
 * format in the language registry) and time zone, only through `Intl`. Amounts and numbers are decimal
 * strings (from `Decimal`/`Money` of `@willowsum/domain-kernel`), never JS numbers: `Intl.NumberFormat`
 * formats a decimal string exactly. The minus is always U+2212 (DS-04).
 */
const MINUS = "\u2212";
const DECIMAL = /^[-+]?\d+(\.\d+)?$/;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** An instant: date, time and an explicit UTC offset (`Z` or `±hh:mm`). */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;

/** The regional format of a language, e.g. `uk` → `uk-UA`. */
export const formatLocaleOf = (locale: Locale): string => languageOf(locale).format;

/** `Intl.NumberFormat` accepts decimal strings (exact); its TypeScript types still say `number`. */
type DecimalString = `${number}`;

function decimal(value: string): DecimalString {
  if (!DECIMAL.test(value)) throw new RangeError("Not a plain decimal string");
  return value as DecimalString;
}

const withMinus = (text: string) => text.replace(/-/g, MINUS);

/** A number, all of its digits kept: «1 234 567,891» (uk), «1,234,567.891» (en). */
export function formatNumber(locale: Locale, value: string): string {
  const format = new Intl.NumberFormat(formatLocaleOf(locale), { maximumFractionDigits: 100 });
  return withMinus(format.format(decimal(value)));
}

/**
 * An amount with its currency, rounded for display only (half to even) to the currency's digits:
 * «1 234 567,50 ₴» (uk), «₴1,234,567.50» (en); «−42,10 €»; a currency without a symbol shows its code.
 */
export function formatMoney(locale: Locale, value: string, currency: string): string {
  if (!CURRENCY_CODE.test(currency)) throw new RangeError("Not an ISO 4217 currency code");
  const format = new Intl.NumberFormat(formatLocaleOf(locale), {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    roundingMode: "halfEven",
    signDisplay: "negative",
  });
  return withMinus(format.format(decimal(value)));
}

/**
 * A calendar date (`YYYY-MM-DD`, no time zone: a transaction, a payment): «26 жовт. 2026 р.» (uk),
 * «26 Oct 2026» (en). Formatted as written, so it never moves to another day.
 */
export function formatDate(locale: Locale, isoDate: string): string {
  const m = CALENDAR_DATE.exec(isoDate);
  if (!m) throw new RangeError("Not a calendar date (YYYY-MM-DD)");
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day)
    throw new RangeError("No such calendar date");
  return new Intl.DateTimeFormat(formatLocaleOf(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(at);
}

/**
 * A time stamp (stored in UTC) shown in the user's time zone: «26 жовт. 2026 р., 14:05» (uk),
 * «26 Oct 2026, 14:05» (en). The hour cycle follows the regional format.
 */
export function formatDateTime(locale: Locale, instant: string, timeZone: string): string {
  if (!INSTANT.test(instant)) throw new RangeError("Not a time stamp with a UTC offset");
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) throw new RangeError("No such time stamp");
  return new Intl.DateTimeFormat(formatLocaleOf(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(at);
}
