import { analyzeTable, type StatementAnalysis } from "../domain/index.ts";
import { readDelimitedFile, type FileReading, type ReadOptions } from "./read-file.ts";

/**
 * A statement file read and analysed (IMP-06@PoC FR 8): the reading of the file (encoding and delimiter with their
 * alternatives, the format fingerprint) and the engine's decisions on its table, each with alternatives and evidence.
 * Runs only in the isolated parse worker (`isolatedStatementParser`; #607 item 3): the bytes are untrusted.
 */
export interface StatementParse {
  readonly reading: Omit<FileReading, "rows" | "headerRow">;
  readonly analysis: StatementAnalysis;
}

export function parseStatement(bytes: Uint8Array, options: ReadOptions = {}): StatementParse {
  const { rows, headerRow, ...reading } = readDelimitedFile(bytes, options);
  return { reading, analysis: analyzeTable(rows, headerRow, options.skipRows ?? 0) };
}
