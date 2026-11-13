import { languageOf, type Locale } from "./languages.ts";
import { translate } from "./translate.ts";
import type { MessageKey } from "./types.ts";

/**
 * NFR-09 FR 3, П-15: numbers, amounts, dates and time stamps formatted by the user's language (its regional
 * format in the language registry) and time zone, only through `Intl`. Amounts and numbers are decimal
 * strings (from `Decimal`/`Money` of `@willowsum/domain-kernel`), never JS numbers: `Intl.NumberFormat`
 * formats a decimal string exactly. The minus is always U+2212 (DS-04).
 */
const MINUS = "\u2212";
const NBSP = "\u00A0";
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

/** Display options of an amount (DS-04 FR 2, FR 4). */
export interface MoneyFormatOptions {
  /**
   * `true`: a value without an arrow that shows a change or a flow keeps its sign, «+» included:
   * «+3 400,00 €», «−42,80 €» (DS-04 FR 4). Zero after rounding has no sign. Default: only «−».
   */
  signed?: boolean;
  /**
   * Digits after the decimal separator. Default: the currency's own digits (EUR and UAH — 2). A
   * cryptocurrency passes the display precision of its currency registry (DS-04, crypto edge case);
   * a change next to an arrow passes 0 («▲ 9 900 €»).
   */
  digits?: number;
}

function moneyFormat(locale: Locale, currency: string, options: MoneyFormatOptions = {}): Intl.NumberFormat {
  if (!CURRENCY_CODE.test(currency)) throw new RangeError("Not an ISO 4217 currency code");
  const { digits } = options;
  if (digits !== undefined && !(Number.isInteger(digits) && digits >= 0 && digits <= 18))
    throw new RangeError("Digits must be a whole number from 0 to 18");
  return new Intl.NumberFormat(formatLocaleOf(locale), {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    roundingMode: "halfEven",
    signDisplay: options.signed ? "exceptZero" : "negative",
    ...(digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  });
}

/**
 * An amount with its currency, rounded for display only (half to even) to the currency's digits:
 * «1 234 567,50 ₴» (uk), «₴1,234,567.50» (en); «−42,10 €»; a currency without a symbol shows its code.
 * The symbol and the number are joined by a no-break space where the regional format puts a space
 * (DS-04 FR 2, FR 16).
 */
export function formatMoney(
  locale: Locale,
  value: string,
  currency: string,
  options: MoneyFormatOptions = {},
): string {
  return withMinus(moneyFormat(locale, currency, options).format(decimal(value))).replace(/ /g, NBSP);
}

/**
 * DS-04 FR 10: the spoken form of an amount for screen readers — the sign as a word, the number and the
 * full name of the currency in the interface language: «мінус 5,00 євро», «плюс 3 200,00 гривні»
 * (uk), «minus 5.00 euros» (en). The sign follows `signed` as in `formatMoney`. Currency names come
 * from the catalogue (`amount.spoken.currency.<CODE>`); a currency missing there uses its `Intl` name.
 */
export function speakMoney(
  locale: Locale,
  value: string,
  currency: string,
  options: MoneyFormatOptions = {},
): string {
  const format = moneyFormat(locale, currency, options);
  const parts = format.formatToParts(decimal(value));
  const pick = (...types: string[]) =>
    parts
      .filter((p) => types.includes(p.type))
      .map((p) => p.value)
      .join("");
  const number = pick("integer", "group", "decimal", "fraction");
  const sign = parts.find((p) => p.type === "minusSign" || p.type === "plusSign")?.type;
  const category = pluralOf(locale, pick("integer"), pick("fraction"));
  const name =
    catalogueName(locale, `amount.spoken.currency.${currency}.${category}`) ??
    catalogueName(locale, `amount.spoken.currency.${currency}.other`) ??
    // No catalogue names: the `Intl` name of the same displayed value, which agrees with it.
    new Intl.NumberFormat(formatLocaleOf(locale), {
      ...format.resolvedOptions(),
      currencyDisplay: "name",
      signDisplay: "never",
    })
      .formatToParts(decimal(value))
      .find((p) => p.type === "currency")?.value ??
    currency;
  const key: MessageKey =
    sign === "minusSign"
      ? "amount.spoken.minus"
      : sign === "plusSign"
        ? "amount.spoken.plus"
        : "amount.spoken";
  return translate(locale, key, { value: number, currency: name });
}

/** A catalogue message, or undefined when the key is in no catalogue. */
function catalogueName(locale: Locale, key: string): string | undefined {
  const text = translate(locale, key as MessageKey);
  return text === key ? undefined : text;
}

/**
 * The plural category of a displayed number (`Intl.PluralRules` of the regional format). Only the plural
 * operands matter — the last six integer digits, whether there are more, and the shown fraction — so
 * the rules get a small stand-in number, never the amount itself.
 */
function pluralOf(locale: Locale, integer: string, fraction: string): Intl.LDMLPluralRule {
  // CLDR plural operands used by uk, en and the EU languages: i % 10, i % 100, i % 1000000 and v (the
  // count of shown fraction digits). A leading «1» before the last six integer digits keeps all of them
  // and keeps i ≠ 0 and ≠ 1 for long numbers; `minimumFractionDigits` keeps v.
  const tail = integer.length > 6 ? `1${integer.slice(-6)}` : integer || "0";
  return new Intl.PluralRules(formatLocaleOf(locale), { minimumFractionDigits: fraction.length }).select(
    Number(fraction ? `${tail}.${fraction}` : tail),
  );
}

/**
 * The currency symbol of the regional format («€», «₴»; a currency without a symbol gives its code), for
 * the abbreviated form of an amount (`formatCompactAmount` of `@willowsum/ui`).
 */
export function currencySymbolOf(locale: Locale, currency: string): string {
  return (
    moneyFormat(locale, currency)
      .formatToParts(decimal("1"))
      .find((p) => p.type === "currency")?.value ?? currency
  );
}

/** Display options of a percentage (DS-04 FR 5). */
export interface PercentFormatOptions {
  /** `true`: keeps «+» as well as «−» («+2,1 %», «TWR +5,1 %»); zero has no sign. Default: only «−». */
  signed?: boolean;
  /** Exactly this many digits after the separator (0–2). Default: up to two, trailing zeros dropped. */
  digits?: number;
}

function percentDigits(digits: number | undefined): Intl.NumberFormatOptions {
  if (digits === undefined) return { minimumFractionDigits: 0, maximumFractionDigits: 2 };
  if (!(Number.isInteger(digits) && digits >= 0 && digits <= 2))
    throw new RangeError("A percentage shows 0 to 2 digits after the separator");
  return { minimumFractionDigits: digits, maximumFractionDigits: digits };
}

function numberIn(locale: Locale, value: string, options: Intl.NumberFormatOptions): string {
  return withMinus(
    new Intl.NumberFormat(formatLocaleOf(locale), { roundingMode: "halfExpand", ...options }).format(
      decimal(value),
    ),
  );
}

/**
 * DS-04 FR 5: a percentage given in percent («2.4» is 2,4 %), with at most two digits after the
 * separator and the percent sign placed as the language's catalogue says: «2,4 %» (uk-UA, no-break
 * space), «2.4%» (en). ICU writes «2,4%» for uk-UA, so the layout comes from `format.percent`.
 */
export function formatPercent(locale: Locale, value: string, options: PercentFormatOptions = {}): string {
  const number = numberIn(locale, value, {
    ...percentDigits(options.digits),
    signDisplay: options.signed ? "exceptZero" : "negative",
  });
  return translate(locale, "format.percent", { value: number });
}

/** DS-04 FR 14: percentage points, «2 п. п.» (uk), «2 pp» (en), up to two digits after the separator. */
export function formatPoints(locale: Locale, value: string, options: PercentFormatOptions = {}): string {
  const number = numberIn(locale, value, {
    ...percentDigits(options.digits),
    signDisplay: options.signed ? "exceptZero" : "negative",
  });
  return translate(locale, "format.points", { value: number });
}

/** The comparison period after a change: year to year, month to month, week to week. */
export type DeltaPeriod = "day" | "week" | "month" | "quarter" | "year";

/** The amount of a change: a decimal string with its sign and an ISO 4217 code. */
export interface DeltaMoney {
  value: string;
  currency: string;
  /**
   * Digits after the separator. Default: whole units («▲ 9 900 €»); a change that is zero in whole units
   * but not at the currency's digits shows those digits («▲ 0,40 €»).
   */
  digits?: number;
}

/** One change shown with an arrow (DS-04 FR 4, FR 14). Values are decimal strings with their sign. */
export interface DeltaInput {
  /** The change of an amount; shown in whole units of its currency unless `digits` says otherwise. */
  amount?: DeltaMoney;
  /** The relative change in percent, one digit after the separator («15,0 %»). */
  percent?: string;
  /** The change of a percentage in percentage points («2 п. п.»). */
  points?: string;
  /** The comparison period, written after the values («д/д», «т/т», «м/м», «к/к», «р/р»). */
  period?: DeltaPeriod;
}

export type DeltaDirection = "up" | "down" | "none";

export interface FormattedDelta {
  /** The visible text: «▲ 9 900 € · 15,0 % р/р», «▼ 2 п. п. м/м», «– 0,0 %». */
  text: string;
  /** The direction the arrow shows; `none` for a change that is zero after rounding. */
  direction: DeltaDirection;
  /** The accessible name, with «зросло», «знизилось» or «без змін» and the amount spoken in full. */
  label: string;
}

const ARROW: Record<DeltaDirection, string> = { up: "\u25B2", down: "\u25BC", none: "\u2013" };
const PERIOD_KEYS: Record<DeltaPeriod, { short: MessageKey; spoken: MessageKey }> = {
  day: { short: "delta.period.day", spoken: "delta.period.day.spoken" },
  week: { short: "delta.period.week", spoken: "delta.period.week.spoken" },
  month: { short: "delta.period.month", spoken: "delta.period.month.spoken" },
  quarter: { short: "delta.period.quarter", spoken: "delta.period.quarter.spoken" },
  year: { short: "delta.period.year", spoken: "delta.period.year.spoken" },
};
const DIRECTION_KEYS: Record<DeltaDirection, MessageKey> = {
  up: "delta.up",
  down: "delta.down",
  none: "delta.none",
};

/**
 * DS-04 FR 4, FR 14, FR 16: a change with an arrow. The arrow shows the direction, so a part that moves
 * that way has no «+» or «−»: «▲ 9 900 € · 15,0 % р/р», «▼ 200 € · 7,7 % м/м», «▼ 2 п. п. м/м»; a change
 * that is zero after rounding is «– 0,0 %». Each part (arrow with the first value, then each value with
 * its unit) is one unbreakable fragment joined by no-break spaces; a line may break only after «·» and
 * before the period. Parts that move opposite ways (a change from a negative base: +5 000 €, −50 %)
 * never fail: the amount decides the arrow (else the first part that moved), and a part moving the other
 * way is left out: «▲ 5 000 € р/р».
 */
export function formatDelta(locale: Locale, input: DeltaInput): FormattedDelta {
  type Part = { sign: number; plain: [string, string] };
  const parts: Part[] = [];
  const signOf = (text: string) => (text.startsWith(MINUS) ? -1 : /[1-9]/.test(text) ? 1 : 0);
  const absolute = (value: string) => decimal(value).replace(/^[-+]/, "");
  if (input.amount) {
    const { value, currency } = input.amount;
    let { digits } = input.amount;
    if (digits === undefined) {
      // Whole units, unless that hides a change the currency's digits still show («0,40 €», not «0 €»).
      const whole = formatMoney(locale, value, currency, { digits: 0 });
      digits = signOf(whole) === 0 && signOf(formatMoney(locale, value, currency)) !== 0 ? undefined : 0;
    }
    const options = digits === undefined ? {} : { digits };
    parts.push({
      sign: signOf(formatMoney(locale, value, currency, options)),
      plain: [
        formatMoney(locale, absolute(value), currency, options),
        speakMoney(locale, absolute(value), currency, options),
      ],
    });
  }
  if (input.percent !== undefined) {
    const text = formatPercent(locale, absolute(input.percent), { digits: 1 });
    parts.push({ sign: signOf(formatPercent(locale, input.percent, { digits: 1 })), plain: [text, text] });
  }
  if (input.points !== undefined) {
    const text = formatPoints(locale, absolute(input.points));
    parts.push({ sign: signOf(formatPoints(locale, input.points)), plain: [text, text] });
  }
  if (parts.length === 0) throw new RangeError("A change needs an amount, a percentage or points");
  const sign = parts.find((p) => p.sign !== 0)?.sign ?? 0;
  const direction: DeltaDirection = sign > 0 ? "up" : sign < 0 ? "down" : "none";
  // A part that moves against the arrow (a change from a negative base) is left out: a change with an
  // arrow has no sign (DS-04 business rule 3), so that part cannot be shown truthfully beside it.
  const shown = parts.filter((p) => p.sign === 0 || p.sign === sign).map((p) => p.plain);
  const period = input.period ? PERIOD_KEYS[input.period] : undefined;
  const values = shown.map(([text]) => text).join(`${NBSP}\u00B7 `);
  const text = `${ARROW[direction]}${NBSP}${values}${period ? ` ${translate(locale, period.short)}` : ""}`;
  const label = translate(locale, DIRECTION_KEYS[direction], {
    value: shown.map(([, spoken]) => spoken).join(", "),
    period: period ? translate(locale, period.spoken) : "",
  }).trim();
  return { text, direction, label };
}

/**
 * DS-04 FR 13: the mask of an account, card or document number — two middle dots (U+00B7) and the
 * last 4 digits, no space: «··4417». Spaces and dashes in the number are ignored; nothing else is
 * shown, whatever the number's length.
 */
export function maskNumber(number: string): string {
  const digits = number.replace(/[\s-]/g, "");
  if (!/^\d{4,}$/.test(digits)) throw new RangeError("A masked number needs at least 4 digits");
  return `\u00B7\u00B7${digits.slice(-4)}`;
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
