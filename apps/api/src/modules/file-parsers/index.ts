// Public interface of the file-parsers module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const fileParsersModule = defineModule({
  name: "file-parsers",
  publishes: [],
  consumes: [],
});

export { FileTooLargeError, fingerprintOf, readDelimitedFile, READ_LIMITS } from "./application/index.ts";
export type { FileReading, ReadOptions } from "./application/index.ts";
export {
  compareSignatures,
  compilePattern,
  DELIMITERS,
  ENCODINGS,
  PATTERN_LIMITS,
  signatureSimilarity,
  TABLE_LIMITS,
  TableLimitError,
} from "./domain/index.ts";
export type {
  CompiledPattern,
  Delimiter,
  Encoding,
  FormatMatch,
  FormatSignature,
  PatternIssue,
  Quote,
  SafePattern,
  TableCeiling,
} from "./domain/index.ts";
