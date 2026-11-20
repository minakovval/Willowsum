import { runIsolated } from "../../../../platform/process/isolated.ts";
import { wipeFieldOpener, type FieldOpener } from "../../../household/index.ts";
import type { ReadOptions, StatementParse } from "../../application/index.ts";
import {
  ACCOUNT_BINDINGS,
  type AccountBindingKind,
  type StatementOptions,
  type TableCeiling,
} from "../../domain/index.ts";

/**
 * Parsing a statement in the isolated worker (IMP-06@PoC FR 8; ARC-06@PoC FR 4; #607 item 3): the file is read into
 * rows and analysed in a fresh worker thread with a heap limit (512 MiB) and a time limit (60 s), never in the API
 * process — the same limits and the same platform runner as file-storage's upload check (row 38). A worker that runs
 * out of memory or time, or crashes, ends alone and the parse is refused with a code.
 */
export const PARSE_LIMITS = { memoryMb: 512, timeoutMs: 60_000, concurrent: 2 } as const;

/**
 * The engine's version, kept with each parsed file (IMP-01@PoC FR 9: the versions applied to each file). A change of
 * the engine's output raises it.
 */
export const PARSE_ENGINE_VERSION = "1";

export type StatementParseRefusal =
  "FILE_TOO_LARGE" | "TABLE_LIMIT" | "PARSE_MEMORY" | "PARSE_TIMEOUT" | "CORRUPTED" | "ACCOUNT_BINDING";

/**
 * The recipe's account binding, still sealed (IMP-06 FR 1; NFR-01 FR 6; wave 2 row 41 part 3): the worker opens
 * `sealedValue` with `opener` (household's `SpaceKeys.fieldOpener` of the recipe's space and field) before it reads the
 * file, and wipes the key. The opener's key is moved into the worker, so it is detached here once the parse starts,
 * and wiped here when it never started. The plaintext is never in this thread. A value the opener cannot open (another
 * space, another field, a wrong or used key) refuses the parse as `ACCOUNT_BINDING`: it fails closed.
 */
export interface SealedAccountBinding {
  readonly by: AccountBindingKind;
  readonly sealedValue: string;
  readonly opener: FieldOpener;
}

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
  parse(
    bytes: Uint8Array,
    options?: ReadOptions,
    statement?: StatementOptions,
    binding?: SealedAccountBinding | (() => Promise<SealedAccountBinding>),
  ): Promise<StatementParse>;
}

export interface StatementParserOptions {
  readonly memoryMb?: number;
  readonly timeoutMs?: number;
  /**
   * At most this many parse workers of this parser at a time (#624: each takes up to 512 MiB and 60 s, and a hostile
   * file can take the 60 s on purpose); the others wait their turn, in order. Default `PARSE_LIMITS.concurrent`.
   */
  readonly concurrent?: number;
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
  const slots = slotsOf(options.concurrent ?? PARSE_LIMITS.concurrent);
  return {
    parse: (bytes, readOptions = {}, statement = {}, given) =>
      // The turn is taken first: a waiting parse holds no key, no copy of the file and no worker. A lazy binding
      // (#624) takes its opener only once the turn is there, the last step before the worker.
      slots.run(async () => {
        const binding = typeof given === "function" ? await given() : given;
        let moved: ArrayBuffer[] = [];
        let sealed: { by: AccountBindingKind; sealedValue: string; opener: FieldOpener } | undefined;
        if (binding) {
          const { by, sealedValue, opener } = binding;
          // A used (detached) or foreign key, or a binding of another kind, is refused before any worker starts.
          if (
            !(opener?.key instanceof ArrayBuffer) ||
            opener.key.byteLength === 0 ||
            !(ACCOUNT_BINDINGS as readonly string[]).includes(by) ||
            typeof sealedValue !== "string"
          ) {
            if (opener) wipeFieldOpener(opener);
            throw new StatementParseError("ACCOUNT_BINDING");
          }
          sealed = {
            by,
            sealedValue,
            opener: { householdId: opener.householdId, field: opener.field, key: opener.key },
          };
          moved = [opener.key];
        }
        let outcome;
        try {
          // The copy is made inside the guard: if it fails (no memory for it), the key is wiped like on any other path.
          const copy = new Uint8Array(bytes);
          outcome = await runIsolated<StatementParse>(
            url,
            { bytes: copy, options: readOptions, statement, binding: sealed },
            [copy.buffer, ...moved],
            limits,
          );
        } finally {
          if (binding) wipeFieldOpener(binding.opener);
        }
        if (outcome.ok) {
          // A parse asked with a binding never comes back without its outcome (fails closed).
          if (binding && outcome.value?.account?.by !== binding.by)
            throw new StatementParseError("ACCOUNT_BINDING");
          return outcome.value;
        }
        if (outcome.failure === "memory") throw new StatementParseError("PARSE_MEMORY");
        if (outcome.failure === "timeout") throw new StatementParseError("PARSE_TIMEOUT");
        if (outcome.failure === "refused") {
          if (outcome.code === "FILE_TOO_LARGE") throw new StatementParseError("FILE_TOO_LARGE");
          if (outcome.code === "ACCOUNT_BINDING") throw new StatementParseError("ACCOUNT_BINDING");
          const [code, ceiling] = outcome.code.split(":");
          if (code === "TABLE_LIMIT" && ceiling && CEILINGS.has(ceiling))
            throw new StatementParseError("TABLE_LIMIT", ceiling as TableCeiling);
        }
        throw new StatementParseError("CORRUPTED");
      }),
  };
}

/** A fixed number of turns; the rest wait in order (first in, first out). */
function slotsOf(size: number): { run<T>(work: () => Promise<T>): Promise<T> } {
  if (!Number.isInteger(size) || size < 1) throw new Error("concurrent is a positive integer");
  let busy = 0;
  const waiting: (() => void)[] = [];
  return {
    async run(work) {
      if (busy >= size) await new Promise<void>((resolve) => waiting.push(resolve));
      else busy += 1;
      try {
        return await work();
      } finally {
        const next = waiting.shift();
        if (next) next();
        else busy -= 1;
      }
    },
  };
}
