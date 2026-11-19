// Domain layer of file-parsers: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export { compilePattern, PATTERN_LIMITS } from "./safe-pattern.ts";
export type { CompiledPattern, PatternIssue, SafePattern } from "./safe-pattern.ts";
export { decodeText, detectEncoding, ENCODINGS, encodingSample } from "./encoding.ts";
export type { Encoding, EncodingGuess, EncodingResult } from "./encoding.ts";
export { DELIMITERS, detectDelimiter, readRows, TABLE_LIMITS, TableLimitError } from "./table.ts";
export type { Delimiter, DelimiterGuess, Quote, TableCeiling, TableReading } from "./table.ts";
export {
  compareSignatures,
  findHeaderRow,
  formatSignature,
  normalizeHeaderCell,
  signatureSimilarity,
  signatureText,
} from "./format.ts";
export type { FormatMatch, FormatSignature } from "./format.ts";
