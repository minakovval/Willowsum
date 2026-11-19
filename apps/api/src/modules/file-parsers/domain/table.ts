/**
 * Reading a delimited table (CSV, TSV) from decoded text (IMP-06@PoC FR 1: delimiter and quotes; FR 8: the delimiter's
 * alternatives). The text is untrusted: the reading is one pass over it, bounded by IMP-01@PoC FR 13's ceilings (20 000
 * rows, 2 million cells) and by the columns of a row and the characters of a cell, and stops with `TableLimitError` at
 * the first one exceeded. A cell is text: «=…», «+…», «@…» are kept as written and never evaluated (no formulas run).
 */
export const TABLE_LIMITS = {
  /** IMP-01@PoC FR 13 (file-storage's `PARSE_CEILINGS.rows`): records with a non-empty cell, the header too. */
  maxRows: 20_000,
  /** Lines of the file, the empty ones too: empty lines are not records, but each is stored as a row. */
  maxLines: 40_000,
  /** IMP-01@PoC FR 13 (file-storage's `PARSE_CEILINGS.cells`). */
  maxCells: 2_000_000,
  /** Columns of a row (lead decision, IMP-06). */
  maxColumns: 512,
  /** Characters of a cell (lead decision, IMP-06). */
  maxCellChars: 32_768,
} as const;

export type TableCeiling = "rows" | "cells" | "columns" | "cell-length";

export class TableLimitError extends Error {
  readonly ceiling: TableCeiling;
  readonly limit: number;
  constructor(ceiling: TableCeiling, limit: number) {
    super(`table ceiling exceeded: ${ceiling}`);
    this.ceiling = ceiling;
    this.limit = limit;
    this.name = "TableLimitError";
  }
}

export const DELIMITERS = [",", ";", "\t", "|"] as const;
export type Delimiter = (typeof DELIMITERS)[number];
/** The quote character; null — quotes are text («none» in a recipe). */
export type Quote = '"' | "'" | null;

export interface TableReading {
  readonly rows: readonly (readonly string[])[];
  /** A quote opened and never closed: its cell runs to the end of the file. */
  readonly unclosedQuote: boolean;
}

/**
 * Reads the rows of the text (all, or only the `firstRows`). Trailing empty lines are dropped; an empty line inside
 * the table is a row of one cell.
 */
export function readRows(
  text: string,
  options: { readonly delimiter: string; readonly quote: Quote; readonly firstRows?: number },
): TableReading {
  const { delimiter, quote, firstRows } = options;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let cells = 0;
  let records = 0;
  let quoted = false;
  let unclosedQuote = false;
  const push = () => {
    if (cell.length > TABLE_LIMITS.maxCellChars)
      throw new TableLimitError("cell-length", TABLE_LIMITS.maxCellChars);
    row.push(cell);
    cell = "";
    if (row.length > TABLE_LIMITS.maxColumns) throw new TableLimitError("columns", TABLE_LIMITS.maxColumns);
    if (++cells > TABLE_LIMITS.maxCells) throw new TableLimitError("cells", TABLE_LIMITS.maxCells);
  };
  const endRow = () => {
    push();
    rows.push(row);
    if (rows.length > TABLE_LIMITS.maxLines) throw new TableLimitError("rows", TABLE_LIMITS.maxRows);
    if (row.some((c) => c !== "") && ++records > TABLE_LIMITS.maxRows)
      throw new TableLimitError("rows", TABLE_LIMITS.maxRows);
    row = [];
  };
  // A cell is cut out of the text in runs (`from` … `i`), never appended character by character: appending builds a
  // rope of one node per character, about 30 times the file in memory.
  let i = 0;
  let from = 0;
  const flush = (to: number) => {
    if (to > from) cell += text.slice(from, to);
  };
  while (i < text.length && (firstRows === undefined || rows.length < firstRows)) {
    const c = text[i]!;
    if (quoted) {
      if (c === quote) {
        flush(i);
        if (text[i + 1] === quote) {
          from = i + 1; // the second quote is the cell's text
          i += 2;
        } else {
          quoted = false;
          from = ++i;
        }
      } else i++;
    } else if (c === quote && cell.length === 0 && i === from) {
      quoted = true;
      from = ++i;
    } else if (c === delimiter) {
      flush(i);
      push();
      from = ++i;
    } else if (c === "\r" || c === "\n") {
      flush(i);
      endRow();
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
      from = i;
    } else i++;
    if (cell.length + (i - from) > TABLE_LIMITS.maxCellChars)
      throw new TableLimitError("cell-length", TABLE_LIMITS.maxCellChars);
  }
  if (firstRows !== undefined && rows.length >= firstRows) return { rows, unclosedQuote };
  flush(i);
  if (quoted) unclosedQuote = true;
  if (cell.length > 0 || row.length > 0 || quoted) endRow();
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c === "")) rows.pop();
  return { rows, unclosedQuote };
}

export interface DelimiterGuess {
  readonly delimiter: Delimiter;
  /** 0–1, two decimals: the share of sampled lines with the most common number of columns (≥ 2). */
  readonly score: number;
  /** FR 8: the live example — the first non-empty sampled row split by this delimiter (≤ 5 cells, ≤ 40 characters each). */
  readonly sample: readonly string[];
}

/** Lines sampled to choose the delimiter. */
const DELIMITER_SAMPLE_ROWS = 50;

/** The delimiter of the text with the alternatives (FR 8); ties go to the order of `DELIMITERS`. */
export function detectDelimiter(
  text: string,
  quote: Quote,
): { readonly chosen: DelimiterGuess; readonly alternatives: readonly DelimiterGuess[] } {
  const guesses = DELIMITERS.map((delimiter): DelimiterGuess => {
    let rows: readonly (readonly string[])[];
    try {
      rows = readRows(text, { delimiter, quote, firstRows: DELIMITER_SAMPLE_ROWS }).rows;
    } catch (error) {
      if (!(error instanceof TableLimitError)) throw error;
      rows = []; // a cell or a row past the bounds: this delimiter cannot be the file's
    }
    const sample = rows.filter((r) => r.some((c) => c.trim() !== ""));
    const counts = new Map<number, number>();
    for (const r of sample) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    let best = 0;
    for (const [width, n] of counts) if (width >= 2 && n > best) best = n;
    const example = (sample[0] ?? []).slice(0, 5).map((c) => c.slice(0, 40));
    return {
      delimiter,
      score: sample.length ? Math.round((best / sample.length) * 100) / 100 : 0,
      sample: example,
    };
  });
  const sorted = [...guesses].sort((a, b) => b.score - a.score);
  return { chosen: sorted[0]!, alternatives: sorted.slice(1) };
}
