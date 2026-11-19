import { isCurrencyCode } from "@willowsum/domain-kernel";

/**
 * Recognising the currency of a cell (IMP-02@PoC FR 9, FR 10, AC7, AC8, AC12, EC1): ISO 4217 alphabetic codes (and
 * the crypto codes of the kernel's table), ISO numeric codes in a currency column (980 = UAH) and symbols. A symbol
 * that several currencies print (the dollar sign, «kr», «¥») stays ambiguous until a recipe's symbol, the country of
 * the statement's IBAN or the recipe settles it. Local names («гривня», «Schweizer Franken») and codes that are not
 * current ISO codes (RUR, HRK) are «unknown»: the user decides, the engine never converts an amount itself.
 */
export const ISO_NUMERIC: Readonly<Record<string, string>> = {
  "036": "AUD",
  "124": "CAD",
  "156": "CNY",
  "203": "CZK",
  "208": "DKK",
  "348": "HUF",
  "352": "ISK",
  "376": "ILS",
  "392": "JPY",
  "398": "KZT",
  "414": "KWD",
  "498": "MDL",
  "578": "NOK",
  "752": "SEK",
  "756": "CHF",
  "826": "GBP",
  "840": "USD",
  "946": "RON",
  "949": "TRY",
  "975": "BGN",
  "978": "EUR",
  "980": "UAH",
  "981": "GEL",
  "985": "PLN",
};

/** Symbols as printed (lower case, no final dot) and the currencies that print them. */
const SYMBOLS: Readonly<Record<string, readonly string[]>> = {
  "₴": ["UAH"],
  грн: ["UAH"],
  "€": ["EUR"],
  zł: ["PLN"],
  "£": ["GBP"],
  $: ["USD", "CAD", "AUD", "NZD", "SGD", "HKD", "MXN"],
  kr: ["SEK", "NOK", "DKK", "ISK"],
  "¥": ["JPY", "CNY"],
};

/** The currency of a country (the first two letters of an IBAN) for an ambiguous symbol. */
const COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  AU: "AUD",
  CA: "CAD",
  CN: "CNY",
  DK: "DKK",
  FO: "DKK",
  GL: "DKK",
  HK: "HKD",
  IS: "ISK",
  JP: "JPY",
  MX: "MXN",
  NO: "NOK",
  NZ: "NZD",
  SE: "SEK",
  SG: "SGD",
  US: "USD",
};

/** Characters of an unrecognised mark carried out of the worker. */
export const MARK_CHARS = 16;

export interface CurrencyHints {
  /** The recipe's symbol dictionary (`numbers.currencySymbols`): a symbol as printed → a code. */
  readonly symbols?: Readonly<Record<string, string>>;
  /** The country of the statement's IBAN, two letters. */
  readonly country?: string | null;
}

export type CurrencyRecognition =
  | {
      readonly status: "code";
      readonly code: string;
      readonly via: "iso" | "numeric" | "symbol" | "recipe" | "country";
    }
  | { readonly status: "ambiguous"; readonly mark: string; readonly candidates: readonly string[] }
  | { readonly status: "unknown"; readonly mark: string };

const symbolKey = (text: string): string => text.toLowerCase().replace(/\.$/, "");

/** The currency a cell or a mark names, or null for an empty one. */
export function recognizeCurrency(text: string, hints: CurrencyHints = {}): CurrencyRecognition | null {
  const t = text.trim();
  if (t === "") return null;
  const mark = t.slice(0, MARK_CHARS);
  const recipe = hints.symbols
    ? (Object.entries(hints.symbols).find(([s]) => s === t || symbolKey(s) === symbolKey(t))?.[1] ?? null)
    : null;
  if (recipe !== null && isCurrencyCode(recipe)) return { status: "code", code: recipe, via: "recipe" };
  const upper = t.toUpperCase();
  if (/^[A-Z]{3,4}$/.test(upper) && isCurrencyCode(upper)) return { status: "code", code: upper, via: "iso" };
  if (/^\d{3}$/.test(t)) {
    const code = ISO_NUMERIC[t];
    return code ? { status: "code", code, via: "numeric" } : { status: "unknown", mark };
  }
  const candidates = Object.hasOwn(SYMBOLS, symbolKey(t)) ? SYMBOLS[symbolKey(t)]! : null;
  if (candidates) {
    if (candidates.length === 1) return { status: "code", code: candidates[0]!, via: "symbol" };
    const country = hints.country ? COUNTRY_CURRENCY[hints.country.toUpperCase()] : undefined;
    if (country && candidates.includes(country)) return { status: "code", code: country, via: "country" };
    return { status: "ambiguous", mark, candidates };
  }
  return { status: "unknown", mark };
}

/** A cell that reads as a currency for the column's kind: a known code, an ISO numeric code or a symbol. */
export function isCurrencyCell(cell: string): boolean {
  const r = recognizeCurrency(cell);
  return r !== null && r.status !== "unknown";
}

/** A cell printed as a three-letter upper-case code, known or not (RUR, HRK): a currency column's content. */
export const isCodeLike = (cell: string): boolean => /^[A-Z]{3}$/.test(cell.trim());

const AMOUNT_MARK =
  /^([A-Za-z]{3,4}|[₴$€£¥]|zł|грн\.?|kr\.?)\s*[-+−–(\d]|[\d)]\s*([A-Za-z]{3,4}|[₴$€£¥]|zł|грн\.?|kr\.?)$/u;

/** The currency mark printed with an amount («12,50 kr», «$ 3.00», «-5,00 грн»), or null. */
export function amountMark(cell: string): string | null {
  const m = AMOUNT_MARK.exec(cell.trim());
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/**
 * The currency code in a column's header («Сума (UAH)», «Amount, EUR», «Залишок EUR»): upper case as printed, in
 * brackets or the header's last word — never a word of the header's text that happens to be a code (`ALL`, #624).
 */
export function headerCurrency(header: string): string | null {
  const m = /(?:^|[\s([,/])([A-Z]{3})(?:[)\]]|\s*$)/.exec(header);
  const code = m?.[1];
  if (!code || !isCurrencyCode(code)) return null;
  const bracketed = new RegExp(`[([]\\s*${code}\\s*[)\\]]`).test(header);
  const last = new RegExp(`(?:^|[\\s,/])${code}\\s*$`).test(header);
  // A header all in capitals («ALL AMOUNTS EUR») names its code only in brackets.
  const shouting = header.replace(code, "").replace(/[^A-Za-zА-Яа-яІіЇїЄєҐґ]/g, "");
  if (!bracketed && shouting.length > 0 && shouting === shouting.toUpperCase()) return null;
  return bracketed || last ? code : null;
}

/** The country of the first IBAN-shaped value in the rows before the table (only the two letters leave the worker). */
export function ibanCountry(rows: readonly (readonly string[])[]): string | null {
  for (const row of rows)
    for (const cell of row) {
      const m = /(?:^|[^A-Z0-9])([A-Z]{2})\d{2}[A-Z0-9]{11,30}(?![A-Z0-9])/.exec(cell.replace(/\s+/g, ""));
      if (m) return m[1]!;
    }
  return null;
}
