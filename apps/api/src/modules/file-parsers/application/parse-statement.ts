import {
  analyzeTable,
  matchAccount,
  type AccountBindingKind,
  type AccountMatch,
  readEvents,
  type StatementAnalysis,
  type StatementEvents,
  type StatementOptions,
} from "../domain/index.ts";
import { readDelimitedFile, type FileReading, type ReadOptions } from "./read-file.ts";

/**
 * A statement file read, analysed and read into events (IMP-06@PoC FR 8; IMP-02@PoC FR 3–5, FR 8–12): the reading of
 * the file (encoding and delimiter with their alternatives, the format fingerprint), the engine's decisions on its
 * table, each with alternatives and evidence, and its rows as events with a main leg and a fee leg. Runs only in the
 * isolated parse worker (`isolatedStatementParser`; #607 item 3): the bytes are untrusted. Never logged or audited:
 * the analysis and the events hold the file's cells.
 */
export interface StatementParse {
  readonly reading: Omit<FileReading, "rows" | "headerRow">;
  readonly analysis: StatementAnalysis;
  readonly events: StatementEvents;
  /** The binding to the recipe's account (IMP-06 FR 1): its outcome only, never the value; null without one. */
  readonly account: AccountMatch | null;
}

/** The recipe's account value, opened in the worker (wave 2 row 41 part 3). Never leaves the worker. */
export interface OpenedAccountBinding {
  readonly by: AccountBindingKind;
  readonly value: string;
}

export function parseStatement(
  bytes: Uint8Array,
  options: ReadOptions = {},
  statement: StatementOptions = {},
  binding?: OpenedAccountBinding,
): StatementParse {
  const { rows, headerRow, ...reading } = readDelimitedFile(bytes, options);
  const firstRow = options.skipRows ?? 0;
  const analysis = analyzeTable(rows, headerRow, firstRow);
  const events = readEvents(rows, headerRow, firstRow, analysis, statement);
  const account = binding
    ? matchAccount(rows.slice(firstRow, headerRow ?? firstRow), binding.by, binding.value)
    : null;
  return { reading, analysis, events, account };
}
