/**
 * Reading one cell as a date or as a number under one hypothesis (IMP-06@PoC FR 8, FR 11, FR 12): the hypotheses are
 * compared by how many cells each can read, and the reading is the live example of a hypothesis. Pure: no clock (FR 9)
 * — a two-digit year is shown as 20YY here; the window of FR 10 needs the server's date and is applied when rows are
 * read. Numbers stay text: never a float (IMP-02@PoC FR 6).
 */
export const DATE_ORDERS = ["dmy", "mdy", "ymd"] as const;
export type DateOrder = (typeof DATE_ORDERS)[number];

export interface DateCell {
  /** The three numbers in the order printed, and how many digits each had. */
  readonly parts: readonly [string, string, string];
  readonly separator: string;
  /** «HH:mm», «HH:mm:ss» or null. */
  readonly time: "HH:mm" | "HH:mm:ss" | null;
}

const DATE = /^(\d{1,4})([./-])(\d{1,2})\2(\d{1,4})(?:[ T](\d{1,2}):(\d{2})(:\d{2})?)?$/;

/** Characters of a cell that can be a date or a number: a longer cell is text. It bounds what a reading and an example
 * carry out of the worker, and the work of the patterns below. */
export const VALUE_CELL_CHARS = 64;

export function dateCell(cell: string): DateCell | null {
  const text = cell.trim();
  if (text.length > VALUE_CELL_CHARS) return null;
  const m = DATE.exec(text);
  if (!m) return null;
  return {
    parts: [m[1]!, m[3]!, m[4]!],
    separator: m[2]!,
    time: m[5] === undefined ? null : m[7] === undefined ? "HH:mm" : "HH:mm:ss",
  };
}

const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isoDate(year: string, month: string, day: string): string | null {
  if (year.length !== 2 && year.length !== 4) return null;
  const y = year.length === 2 ? 2000 + Number(year) : Number(year);
  const mo = Number(month);
  const d = Number(day);
  if (mo < 1 || mo > 12 || d < 1) return null;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  if (d > (mo === 2 && !leap ? 28 : DAYS[mo - 1]!)) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The ISO date (YYYY-MM-DD) the cell reads as under `order`, or null when it cannot be read so. */
export function readDate(cell: DateCell, order: DateOrder): string | null {
  const [a, b, c] = cell.parts;
  if (order === "ymd") return a.length === 4 ? isoDate(a, b, c) : null;
  if (a.length > 2 || b.length > 2) return null;
  return order === "dmy" ? isoDate(c, b, a) : isoDate(c, a, b);
}

/** The recipe's `dates.format` for the order and the widths seen in a column, e.g. «DD.MM.YYYY HH:mm». */
export function dateFormatLabel(cells: readonly DateCell[], order: DateOrder): string {
  const first = cells[0]!;
  const short = [0, 1, 2].map((i) => cells.some((c) => c.parts[i]!.length === 1));
  const twoDigitYear = cells.every((c) => c.parts[order === "ymd" ? 0 : 2]!.length === 2);
  const year = twoDigitYear ? "YY" : "YYYY";
  const tokens: Record<"d" | "m" | "y", string> = {
    d: "",
    m: "",
    y: year,
  };
  const letters = order.split("") as ("d" | "m" | "y")[];
  letters.forEach((letter, i) => {
    if (letter === "d") tokens.d = short[i] ? "D" : "DD";
    if (letter === "m") tokens.m = short[i] ? "M" : "MM";
  });
  const date = letters.map((l) => tokens[l]).join(first.separator);
  return first.time ? `${date} ${first.time}` : date;
}

/** A number cell: the sign or parentheses, and the digits with their separators. */
export interface NumberCell {
  readonly negative: boolean;
  readonly body: string;
}

const CURRENCY_MARK = /^(?:[A-Z]{3}|[₴$€£¥]|zł|грн\.?)\s*|\s*(?:[A-Z]{3}|[₴$€£¥]|zł|грн\.?)$/giu;
const NUMBER = /^([-+−–]?)\s*(\(?)\s*(\d[\d\s\u00a0\u202f.,'’]*\d|\d)\s*(\)?)\s*(-?)$/u;

export function numberCell(cell: string): NumberCell | null {
  const text = cell.trim();
  if (text.length > VALUE_CELL_CHARS) return null;
  const m = NUMBER.exec(text.replace(CURRENCY_MARK, ""));
  if (!m) return null;
  if ((m[2] === "(") !== (m[4] === ")")) return null;
  return {
    negative: m[1] === "-" || m[1] === "−" || m[1] === "–" || m[2] === "(" || m[5] === "-",
    body: m[3]!.replace(/[\u00a0\u202f]/g, " ").replace(/’/g, "'"),
  };
}

export type DecimalSeparator = "." | ",";
export type ThousandsSeparator = "," | "." | " " | "'" | "none";

export interface NumberReading {
  /** The value as a plain decimal text: «-1234.5». */
  readonly value: string;
  readonly thousands: ThousandsSeparator;
  /** True when the decimal separator was not seen (the cell is an integer under this hypothesis). */
  readonly integer: boolean;
}

/** The decimal text a number cell reads as when `decimal` is the decimal separator, or null when it cannot. */
export function readNumber(cell: NumberCell, decimal: DecimalSeparator): NumberReading | null {
  const pieces = cell.body.split(decimal);
  if (pieces.length > 2) return null;
  const [whole, fraction] = pieces as [string, string | undefined];
  if (fraction !== undefined && !/^\d{1,18}$/.test(fraction)) return null;
  let thousands: ThousandsSeparator = "none";
  let digits = whole;
  if (!/^\d+$/.test(whole)) {
    const groups = whole.split(/[ ,.']/);
    const seps = new Set(whole.replace(/\d/g, ""));
    if (seps.size !== 1) return null;
    const sep = [...seps][0] as ThousandsSeparator;
    if (sep === decimal) return null;
    if (!/^\d{1,3}$/.test(groups[0]!) || groups.slice(1).some((g) => !/^\d{3}$/.test(g))) return null;
    thousands = sep;
    digits = groups.join("");
  }
  const int = digits.replace(/^0+(?=\d)/, "");
  const value = `${cell.negative ? "-" : ""}${int}${fraction === undefined ? "" : `.${fraction}`}`;
  return { value, thousands, integer: fraction === undefined };
}

/** «1,234» — a cell both decimal separators read, as an integer under one and with three decimals under the other. */
export function isAmbiguousInteger(cell: NumberCell): boolean {
  return /^\d{1,3}[.,]\d{3}$/.test(cell.body);
}

/** The recipe-facing label of a number format, e.g. «1 234,56». */
export function numberFormatLabel(decimal: DecimalSeparator, thousands: ThousandsSeparator): string {
  return `1${thousands === "none" ? "" : thousands}234${decimal}56`;
}
