import { createHash } from "node:crypto";
import {
  decodeText,
  detectDelimiter,
  detectEncoding,
  encodingSample,
  findHeaderRow,
  formatSignature,
  readRows,
  signatureText,
  type Delimiter,
  type DelimiterGuess,
  type Encoding,
  type EncodingGuess,
  type FormatSignature,
  type Quote,
} from "../domain/index.ts";

/**
 * Reading a delimited statement file (CSV, TSV) up to its table and its format (IMP-06@PoC FR 1, FR 7, FR 8, FR 9): the
 * encoding, the delimiter, the rows, the header row and the fingerprint. A recipe's file rules are taken as given
 * (reason «recipe»); otherwise each is detected with its alternatives. Deterministic: no clock, no randomness, no
 * network; the bytes are untrusted and the reading is bounded (25 MiB, then the table's ceilings).
 */
export const READ_LIMITS = {
  /** IMP-01@PoC FR 13 (file-storage's `FILE_LIMITS.fileBytes`). */
  fileBytes: 25 * 1024 * 1024,
} as const;

export class FileTooLargeError extends Error {
  readonly limit = READ_LIMITS.fileBytes;
  constructor() {
    super("file too large");
    this.name = "FileTooLargeError";
  }
}

/** The recipe's file rules (IMP-06 FR 1); rows are 0-based here. */
export interface ReadOptions {
  readonly encoding?: Encoding;
  readonly delimiter?: Delimiter;
  /** The quote character; null — none. Default «"». */
  readonly quote?: Quote;
  /** Rows before the table that are skipped (never read as the preamble, EC3). */
  readonly skipRows?: number;
  /** The header row; omitted — found after the skipped rows. */
  readonly headerRow?: number;
}

export interface FileReading {
  readonly encoding: {
    readonly chosen: Omit<EncodingGuess, "reason"> & { readonly reason: EncodingGuess["reason"] | "recipe" };
    readonly alternatives: readonly EncodingGuess[];
  };
  readonly delimiter: {
    readonly chosen: DelimiterGuess & { readonly reason: "content" | "recipe" };
    readonly alternatives: readonly DelimiterGuess[];
  };
  readonly rows: readonly (readonly string[])[];
  readonly unclosedQuote: boolean;
  /** U+FFFD in the decoded text: bytes the chosen encoding could not read (also past the scored sample). */
  readonly replacementChars: number;
  /** 0-based; null — no header found. */
  readonly headerRow: number | null;
  readonly format: { readonly signature: FormatSignature; readonly fingerprint: string } | null;
}

/** The format fingerprint (FR 7): «fp1:» and the SHA-256 of the signature's canonical text. */
export function fingerprintOf(signature: FormatSignature): string {
  return `fp1:${createHash("sha256").update(signatureText(signature), "utf8").digest("hex")}`;
}

export function readDelimitedFile(bytes: Uint8Array, options: ReadOptions = {}): FileReading {
  if (bytes.length > READ_LIMITS.fileBytes) throw new FileTooLargeError();
  const detected = detectEncoding(bytes);
  const encoding: FileReading["encoding"] = options.encoding
    ? {
        chosen: {
          encoding: options.encoding,
          score: 1,
          reason: "recipe",
          sample: encodingSample(bytes, options.encoding),
        },
        alternatives: [detected.chosen, ...detected.alternatives].filter(
          (g) => g.encoding !== options.encoding,
        ),
      }
    : detected;
  const text = decodeText(bytes, encoding.chosen.encoding);
  const quote = options.quote === undefined ? '"' : options.quote;
  const found = detectDelimiter(text, quote);
  const delimiter: FileReading["delimiter"] = options.delimiter
    ? {
        chosen: {
          delimiter: options.delimiter,
          score: 1,
          reason: "recipe",
          sample:
            [found.chosen, ...found.alternatives].find((g) => g.delimiter === options.delimiter)?.sample ??
            [],
        },
        alternatives: [found.chosen, ...found.alternatives].filter((g) => g.delimiter !== options.delimiter),
      }
    : { chosen: { ...found.chosen, reason: "content" }, alternatives: found.alternatives };
  // The encoding is chosen on the first 64 KiB: bytes past it that do not decode are counted, never hidden (AC12).
  let replacementChars = 0;
  for (let at = text.indexOf("\uFFFD"); at >= 0; at = text.indexOf("\uFFFD", at + 1)) replacementChars++;
  const { rows, unclosedQuote } = readRows(text, { delimiter: delimiter.chosen.delimiter, quote });
  const skipRows = options.skipRows ?? 0;
  const headerRow = options.headerRow ?? findHeaderRow(rows, skipRows);
  const signature = formatSignature(rows, { skipRows, headerRow });
  return {
    encoding,
    delimiter,
    rows,
    unclosedQuote,
    replacementChars,
    headerRow: signature ? headerRow : null,
    format: signature ? { signature, fingerprint: fingerprintOf(signature) } : null,
  };
}
