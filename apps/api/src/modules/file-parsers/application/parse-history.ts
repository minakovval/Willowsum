import {
  analyzeHistoryColumns,
  analyzeTable,
  historyMissing,
  historyRows,
  readEvents,
  statementView,
  transferValues,
  withColumnRoles,
  type CurrencyAnalysis,
  type DateFormat,
  type Decision,
  type HistoryColumn,
  type HistoryMissing,
  type HistoryReadOptions,
  type HistoryRow,
  type NumberFormat,
  type SignMode,
  type TableAnalysis,
  type TransferValue,
} from "../domain/index.ts";
import { readDelimitedFile, type FileReading, type ReadOptions } from "./read-file.ts";

/**
 * A history file read (BUD-21@PoC FR 3–5): the reading of the file, the table, every column's role — the statement's
 * and the user's own (category, subcategory, transfer mark, tags, account) — with alternatives and evidence, the
 * formats, the rows as read, the transfer column's values and what the file lacks for rules. Runs only in the isolated
 * parse worker, like a statement's parse (#607 item 3). Holds the file's cells: never logged or audited.
 */
export interface HistoryParse {
  readonly reading: Omit<FileReading, "rows" | "headerRow">;
  readonly table: TableAnalysis;
  readonly columns: readonly HistoryColumn[];
  readonly dates: Decision<DateFormat> | null;
  readonly numbers: Decision<NumberFormat> | null;
  readonly sign: Decision<SignMode> | null;
  readonly currency: CurrencyAnalysis;
  readonly rows: readonly HistoryRow[];
  readonly transfers: { readonly values: readonly TransferValue[]; readonly more: boolean };
  readonly missing: readonly HistoryMissing[];
}

export function parseHistory(
  bytes: Uint8Array,
  options: ReadOptions = {},
  corrections: HistoryReadOptions = {},
): HistoryParse {
  // FR 6: the structure as the user chose it (FR 4: encoding, delimiter, table) over the engine's.
  const { rows, headerRow, ...reading } = readDelimitedFile(bytes, {
    ...options,
    ...(corrections.encoding ? { encoding: corrections.encoding } : {}),
    ...(corrections.delimiter ? { delimiter: corrections.delimiter } : {}),
    ...(corrections.headerRow ? { headerRow: corrections.headerRow - 1 } : {}),
  });
  const firstRow = options.skipRows ?? 0;
  const analysis = analyzeTable(rows, headerRow, firstRow);
  const columns = withColumnRoles(
    analyzeHistoryColumns(rows, headerRow, firstRow, analysis),
    corrections.columns,
  );
  const view = statementView(analysis, columns, corrections);
  const read = historyRows(rows, columns, readEvents(rows, headerRow, firstRow, view));
  return {
    reading,
    table: view.table,
    columns,
    dates: view.dates,
    numbers: view.numbers,
    sign: view.sign,
    currency: view.currency,
    rows: read,
    transfers: transferValues(read, columns),
    missing: historyMissing(columns),
  };
}
