// Domain layer of file-parsers: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export { checkPattern, compilePattern, PATTERN_LIMITS } from "./safe-pattern.ts";
export type { CompiledPattern, PatternCheck, PatternIssue, SafePattern } from "./safe-pattern.ts";
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
export { analyzeTable, ANALYSIS_LIMITS, ROLES } from "./analysis.ts";
export type {
  ColumnAnalysis,
  CurrencyAnalysis,
  DateFormat,
  Decision,
  DecisionFlag,
  Evidence,
  EvidenceCode,
  Example,
  Hypothesis,
  NumberFormat,
  Role,
  SignMode,
  StatementAnalysis,
  TableAnalysis,
} from "./analysis.ts";
export { DATE_ORDERS } from "./values.ts";
export type { DateOrder, DecimalSeparator, ThousandsSeparator } from "./values.ts";
export { amountMark, headerCurrency, ISO_NUMERIC, recognizeCurrency } from "./currency.ts";
export type { CurrencyHints, CurrencyRecognition } from "./currency.ts";
export { EVENT_LIMITS, readEvents } from "./events.ts";
export type { EventFlag, EventLeg, StatementEvent, StatementEvents, StatementOptions } from "./events.ts";
export {
  ACCOUNT_BINDINGS,
  detectedMask,
  hasCardMask,
  maskedMismatch,
  maskLast4,
  matchAccount,
} from "./account.ts";
export { detectAccount, detectedBank, INSTITUTION_LIMITS } from "./detect.ts";
export type { DetectedAccount, Institution } from "./detect.ts";
export { readFigures } from "./figures.ts";
export type { DeclaredFigures } from "./figures.ts";
export { CHECK_KINDS, checkControls, historyGap } from "./checks.ts";
export type {
  CheckKind,
  CheckStatus,
  ControlCheck,
  HistoryGap,
  HistoryStatus,
  StatementBounds,
} from "./checks.ts";
export { feesTaken, readFeeBasis, withFeeBasis } from "./fees.ts";
export type { FeeBasis, FeeReading } from "./fees.ts";
export { readCardDebt } from "./card-debt.ts";
export type { CardDebt, CardDebtReading } from "./card-debt.ts";
export { SIGN_BASES, SIGN_CONFIDENCE, reviewSigns } from "./signs.ts";
export type { RowSign, SignBasis, SignReview } from "./signs.ts";
export { clarifications, readingFits } from "./clarify.ts";
export type { AmountClarification, AmountReading, Clarification, DateOrderClarification } from "./clarify.ts";
export { accountEvidence, FLAG_SEVERITY, reviewStatement } from "./review.ts";
export type {
  AccountEvidence,
  BatchFlag,
  BatchFlagCode,
  MismatchReason,
  Severity,
  StatementChecks,
} from "./review.ts";
export type { AccountBindingKind, AccountMatch } from "./account.ts";
