import type { Role, StatementAnalysis } from "./analysis.ts";
import { amountMark, recognizeCurrency } from "./currency.ts";
import {
  dateCell,
  numberCell,
  readDate,
  readNumber,
  type DateOrder,
  type DecimalSeparator,
} from "./values.ts";

/**
 * The statement's own control figures (IMP-05@PoC FR 1): the opening and the closing balance, the totals of debits
 * and of credits (a labelled row, or a «Разом» row read in the debit and credit columns), the count of operations and
 * the period — as the statement declares them, read from its labelled rows before, inside or after the table. A row
 * that holds a figure is not an operation: its 0-based index is in `exclude` (`readEvents` leaves it out). Amounts are
 * decimal text (never a float); debit and credit totals are kept without their sign. Pure and deterministic.
 */
export interface DeclaredFigures {
  readonly opening: string | null;
  readonly closing: string | null;
  readonly debitTotal: string | null;
  readonly creditTotal: string | null;
  readonly operations: number | null;
  readonly period: { readonly from: string; readonly to: string } | null;
  /** The currency printed with a figure («1 000,00 EUR»), when one is. */
  readonly currency: string | null;
  /** The rows of the file holding figures, from 1. */
  readonly rows: readonly number[];
}

type FigureKind = "opening" | "closing" | "debit-total" | "credit-total" | "operations" | "period" | "total";

/** Labels as printed, lower case; a label matches the start of a cell, followed by anything but a letter. Debit and
 * credit totals come before the plain «Разом», which is read in the debit and credit columns. */
const LABELS: readonly (readonly [FigureKind, readonly string[]])[] = [
  [
    "opening",
    [
      "вхідний залишок",
      "початковий залишок",
      "залишок на початок",
      "вхідне сальдо",
      "сальдо на початок",
      "opening balance",
      "beginning balance",
      "starting balance",
      "start balance",
      "balance brought forward",
    ],
  ],
  [
    "closing",
    [
      "вихідний залишок",
      "кінцевий залишок",
      "залишок на кінець",
      "вихідне сальдо",
      "сальдо на кінець",
      "closing balance",
      "ending balance",
      "end balance",
      "balance carried forward",
    ],
  ],
  [
    "debit-total",
    [
      "сума списань",
      "списання разом",
      "усього списань",
      "всього списань",
      "обороти дебет",
      "оборот дебет",
      "дебетовий оборот",
      "total debits",
      "total debit",
      "debit total",
      "total withdrawals",
      "total paid out",
    ],
  ],
  [
    "credit-total",
    [
      "сума надходжень",
      "надходження разом",
      "усього надходжень",
      "всього надходжень",
      "обороти кредит",
      "оборот кредит",
      "кредитовий оборот",
      "total credits",
      "total credit",
      "credit total",
      "total deposits",
      "total paid in",
    ],
  ],
  [
    "operations",
    [
      "кількість операцій",
      "кількість транзакцій",
      "number of transactions",
      "number of operations",
      "transaction count",
      "transactions count",
    ],
  ],
  ["period", ["період", "за період", "statement period", "period"]],
  ["total", ["разом", "усього", "всього", "підсумок", "підсумки", "total", "totals"]],
];

/** Characters of a cell looked at for a label: a longer cell is a description, not a figure's label. */
const LABEL_CHARS = 120;
const DATE_IN_TEXT = /\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/g;

function labelOf(cell: string): { kind: FigureKind; rest: string } | null {
  const text = cell.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  if (text === "" || text.length > LABEL_CHARS) return null;
  for (const [kind, labels] of LABELS)
    for (const label of labels)
      if (text.startsWith(label) && !/\p{L}/u.test(text.charAt(label.length)))
        return { kind, rest: text.slice(label.length).replace(/^[\s:,.—–-]*/, "") };
  return null;
}

export function readFigures(
  rows: readonly (readonly string[])[],
  headerRow: number | null,
  firstRow: number,
  analysis: StatementAnalysis,
): { readonly figures: DeclaredFigures; readonly exclude: ReadonlySet<number> } {
  const column = (role: Role): number =>
    analysis.columns.find((c) => c.role.chosen.value === role)?.column ?? 0;
  const decimal: DecimalSeparator = analysis.numbers?.chosen.value.decimalSeparator ?? ",";
  const order: DateOrder | null = analysis.dates?.chosen.value.order ?? null;
  const from = headerRow === null ? firstRow : headerRow + 1;
  const amountIn = (cell: string): string | null => {
    const n = numberCell(cell);
    return n ? (readNumber(n, decimal)?.value ?? null) : null;
  };
  const dateIn = (text: string): string | null => {
    const d = dateCell(text);
    if (!d) return null;
    return readDate(d, d.parts[0].length === 4 ? "ymd" : (order ?? "dmy"));
  };
  const found: { -readonly [K in keyof DeclaredFigures]: DeclaredFigures[K] } = {
    opening: null,
    closing: null,
    debitTotal: null,
    creditTotal: null,
    operations: null,
    period: null,
    currency: null,
    rows: [],
  };
  const exclude = new Set<number>();
  const abs = (value: string | null) => (value === null ? null : value.replace(/^-/, ""));

  for (let i = firstRow; i < rows.length; i++) {
    if (i === headerRow) continue;
    const row = rows[i]!;
    // A figure's label is the first filled cell of its row; inside or after the table, a row with a date cell is an
    // operation, never a figure (the columns are not known yet: the table is analysed without the figures' rows).
    const at = row.findIndex((cell) => cell.trim() !== "");
    if (at < 0 || labelOf(row[at]!) === null) continue;
    if (i >= from && row.some((cell) => dateIn(cell.trim()) !== null)) continue;
    const { kind, rest } = labelOf(row[at]!)!;
    const after = [rest, ...row.slice(at + 1)].map((c) => c.trim()).filter((c) => c !== "");
    const firstAmount = after.map(amountIn).find((v) => v !== null) ?? null;
    const markCell = after.find((c) => amountIn(c) !== null);
    let used = false;
    if (kind === "opening" || kind === "closing") {
      if (firstAmount !== null && found[kind] === null) {
        found[kind] = firstAmount;
        used = true;
      }
    } else if (kind === "debit-total" || kind === "credit-total") {
      const key = kind === "debit-total" ? "debitTotal" : "creditTotal";
      if (firstAmount !== null && found[key] === null) {
        found[key] = abs(firstAmount);
        used = true;
      }
    } else if (kind === "operations") {
      const n = after.find((c) => /^\d{1,7}$/.test(c));
      if (n !== undefined && found.operations === null) {
        found.operations = Number(n);
        used = true;
      }
    } else if (kind === "period") {
      const dates = (after.join(" ").match(DATE_IN_TEXT) ?? []).map(dateIn).filter((d) => d !== null);
      if (dates.length >= 2 && found.period === null) {
        found.period = { from: dates[0]!, to: dates[1]! };
        used = true;
      }
    } else {
      // «Разом»: the debit and the credit columns of the row.
      const debit = column("debit");
      const credit = column("credit");
      if (debit > 0 && credit > 0) {
        const d = abs(amountIn(row[debit - 1] ?? ""));
        const c = abs(amountIn(row[credit - 1] ?? ""));
        if (d !== null && found.debitTotal === null) found.debitTotal = d;
        if (c !== null && found.creditTotal === null) found.creditTotal = c;
        used = d !== null || c !== null;
      }
    }
    if (!used) continue;
    exclude.add(i);
    found.rows = [...found.rows, i + 1];
    const mark = markCell ? amountMark(markCell) : null;
    const code = mark ? recognizeCurrency(mark) : null;
    if (found.currency === null && code?.status === "code") found.currency = code.code;
  }
  return { figures: found, exclude };
}
