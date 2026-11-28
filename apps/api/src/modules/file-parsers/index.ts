// Public interface of the file-parsers module (ARC-01 FR 2). Other modules import only this file.
//
// Reading a file into rows (`readDelimitedFile`) and matching a recipe's patterns (`compilePattern(...).match`) are
// not exported: they run only in the isolated parse worker, behind `isolatedStatementParser` (#607 item 3). The API
// process may check a pattern (`checkPattern`) but never run it on a file's text.
import { defineModule } from "../../platform/modules/define.ts";

export const fileParsersModule = defineModule({
  name: "file-parsers",
  publishes: [],
  consumes: [],
});

export {
  isolatedStatementParser,
  PARSE_ENGINE_VERSION,
  PARSE_LIMITS,
  StatementParseError,
} from "./adapters/index.ts";
export type {
  HistoryParser,
  SealedAccountBinding,
  StatementParser,
  StatementParserOptions,
  StatementParseRefusal,
} from "./adapters/index.ts";
export { fingerprintOf, READ_LIMITS } from "./application/index.ts";
export type { FileReading, HistoryParse, ReadOptions, StatementParse } from "./application/index.ts";
export {
  ANALYSIS_LIMITS,
  checkPattern,
  compareSignatures,
  DATE_ORDERS,
  DELIMITERS,
  ENCODINGS,
  PATTERN_LIMITS,
  ROLES,
  signatureSimilarity,
  TABLE_LIMITS,
  TableLimitError,
} from "./domain/index.ts";
export {
  HISTORY_LIMITS,
  HISTORY_MISSING,
  HISTORY_ROLES,
  looksLikeHistory,
  USER_ANALYSIS_ROLES,
} from "./domain/index.ts";
export type {
  ColumnRole,
  HistoryColumn,
  HistoryMissing,
  HistoryReadOptions,
  HistoryRole,
  HistoryRow,
  TransferValue,
  UserAnalysisColumn,
  UserAnalysisRole,
} from "./domain/index.ts";
export {
  ACCOUNT_BINDINGS,
  bankName,
  CHECK_KINDS,
  EVENT_LIMITS,
  FLAG_SEVERITY,
  historyGap,
  INSTITUTION_LIMITS,
  readingFits,
  SIGN_BASES,
} from "./domain/index.ts";
export type {
  AccountEvidence,
  AmountClarification,
  AmountReading,
  BatchFlag,
  BatchFlagCode,
  CheckKind,
  CheckStatus,
  Clarification,
  ControlCheck,
  DateOrderClarification,
  DeclaredFigures,
  DetectedAccount,
  HistoryGap,
  HistoryStatus,
  Institution,
  MismatchReason,
  RowSign,
  Severity,
  SignBasis,
  SignReview,
  StatementBounds,
  StatementChecks,
} from "./domain/index.ts";
export type {
  AccountBindingKind,
  AccountMatch,
  CurrencyRecognition,
  EventFlag,
  EventLeg,
  StatementEvent,
  StatementEvents,
  StatementOptions,
  ColumnAnalysis,
  CurrencyAnalysis,
  DateFormat,
  DateOrder,
  Decision,
  DecisionFlag,
  Delimiter,
  Encoding,
  Evidence,
  EvidenceCode,
  Example,
  FormatMatch,
  FormatSignature,
  Hypothesis,
  NumberFormat,
  PatternCheck,
  PatternIssue,
  Quote,
  Role,
  SignMode,
  StatementAnalysis,
  TableAnalysis,
  TableCeiling,
} from "./domain/index.ts";
