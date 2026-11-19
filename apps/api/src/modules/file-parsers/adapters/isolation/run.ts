import { runIsolated } from "../../../../platform/process/isolated.ts";
import type { ReadOptions, StatementParse } from "../../application/index.ts";
import type { StatementOptions, TableCeiling } from "../../domain/index.ts";

/**
 * Parsing a statement in the isolated worker (IMP-06@PoC FR 8; ARC-06@PoC FR 4; #607 item 3): the file is read into
 * rows and analysed in a fresh worker thread with a heap limit (512 MiB) and a time limit (60 s), never in the API
 * process — the same limits and the same platform runner as file-storage's upload check (row 38). A worker that runs
 * out of memory or time, or crashes, ends alone and the parse is refused with a code.
 */
export const PARSE_LIMITS = { memoryMb: 512, timeoutMs: 60_000 } as const;

export type StatementParseRefusal =
  "FILE_TOO_LARGE" | "TABLE_LIMIT" | "PARSE_MEMORY" | "PARSE_TIMEOUT" | "CORRUPTED";

export class StatementParseError extends Error {
  readonly code: StatementParseRefusal;
  /** TABLE_LIMIT: the ceiling reached (`TABLE_LIMITS`). */
  readonly ceiling: TableCeiling | null;
  constructor(code: StatementParseRefusal, ceiling: TableCeiling | null = null) {
    super(code);
    this.name = "StatementParseError";
    this.code = code;
    this.ceiling = ceiling;
  }
}

export interface StatementParser {
  /**
   * The parse of the file, or a `StatementParseError`. `statement` — the account the file is for and the recipe's
   * currency hints (IMP-02 FR 3, FR 9). The result holds the file's cells: never log or audit it (#624).
   */
  parse(bytes: Uint8Array, options?: ReadOptions, statement?: StatementOptions): Promise<StatementParse>;
}

export interface StatementParserOptions {
  readonly memoryMb?: number;
  readonly timeoutMs?: number;
  /** The worker script; tests pass one that misbehaves on purpose. */
  readonly workerUrl?: URL;
}

const WORKER_URL = new URL("./worker.ts", import.meta.url);
const CEILINGS: ReadonlySet<string> = new Set([
  "rows",
  "cells",
  "columns",
  "cell-length",
] satisfies TableCeiling[]);

export function isolatedStatementParser(options: StatementParserOptions = {}): StatementParser {
  const limits = {
    memoryMb: options.memoryMb ?? PARSE_LIMITS.memoryMb,
    timeoutMs: options.timeoutMs ?? PARSE_LIMITS.timeoutMs,
  };
  const url = options.workerUrl ?? WORKER_URL;
  return {
    async parse(bytes, readOptions = {}, statement = {}) {
      const copy = new Uint8Array(bytes);
      const outcome = await runIsolated<StatementParse>(
        url,
        { bytes: copy, options: readOptions, statement },
        [copy.buffer],
        limits,
      );
      if (outcome.ok) return outcome.value;
      if (outcome.failure === "memory") throw new StatementParseError("PARSE_MEMORY");
      if (outcome.failure === "timeout") throw new StatementParseError("PARSE_TIMEOUT");
      if (outcome.failure === "refused") {
        if (outcome.code === "FILE_TOO_LARGE") throw new StatementParseError("FILE_TOO_LARGE");
        const [code, ceiling] = outcome.code.split(":");
        if (code === "TABLE_LIMIT" && ceiling && CEILINGS.has(ceiling))
          throw new StatementParseError("TABLE_LIMIT", ceiling as TableCeiling);
      }
      throw new StatementParseError("CORRUPTED");
    },
  };
}
