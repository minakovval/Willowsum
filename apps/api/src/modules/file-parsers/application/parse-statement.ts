import {
  analyzeTable,
  detectAccount,
  feesTaken,
  hasCardMask,
  maskedMismatch,
  matchAccount,
  readCardDebt,
  readFigures,
  reviewStatement,
  type StatementChecks,
  type AccountBindingKind,
  type AccountMatch,
  readEvents,
  readFeeBasis,
  withFeeBasis,
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
  /**
   * IMP-05@PoC FR 1–9: the control checks, the bounds for the history gap, the other-account evidence (masked to the
   * last 4 characters), the signs, the clarifications and the batch's flags.
   */
  readonly checks: StatementChecks;
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
  // IMP-05 FR 1: the statement's own figures («Вхідний залишок», «Разом») are found first and left out of the table's
  // analysis and of the events; their values are then read under the table's number format.
  const labelled = readFigures(rows, headerRow, firstRow, analyzeTable(rows, headerRow, firstRow)).exclude;
  const table = labelled.size === 0 ? rows : rows.map((r, i) => (labelled.has(i) ? [] : r));
  const analysis = analyzeTable(table, headerRow, firstRow);
  const { figures: printed, exclude } = readFigures(rows, headerRow, firstRow, analysis);
  const read = readEvents(rows, headerRow, firstRow, analysis, statement, new Set([...labelled, ...exclude]));
  // IMP-05 FR 6 (Рішення власника (2026-11-20), п. 6): a credit card's positive balance is debt; the reading is
  // inverted only when the balance chain confirms it.
  const card = readCardDebt(read, printed, statement.account?.kind);
  const { figures, debt } = card;
  // IMP-02 FR 5 (#698): whether the amounts include their fees; the checks count what the account moved.
  const feeReading = readFeeBasis(card.events, figures, analysis);
  const events = withFeeBasis(card.events, feeReading);
  const preamble = rows.slice(firstRow, headerRow ?? firstRow);
  const account = binding ? matchAccount(preamble, binding.by, binding.value) : null;
  const checks = reviewStatement({
    rows,
    firstRow,
    analysis,
    events: feeReading?.basis === "excluded" ? feesTaken(events) : events,
    figures,
    ...(statement.account ? { account: statement.account } : {}),
    match: account,
    masked: binding ? maskedMismatch(preamble, binding.by, binding.value) : null,
    cardInFile: hasCardMask(preamble),
    cardDebt: debt,
  });
  // IMP-08 FR 2 (row 230): the bank, the one currency and the masked number the file names for its own account.
  const fileCurrencies = [...events.currencies, ...(figures.currency ? [figures.currency] : [])];
  const detected = detectAccount(preamble, fileCurrencies, statement.institutions);
  return { reading, analysis, events, account, checks: { ...checks, detected } };
}
