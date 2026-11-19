// Application layer of file-parsers: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export { FileTooLargeError, fingerprintOf, readDelimitedFile, READ_LIMITS } from "./read-file.ts";
export type { FileReading, ReadOptions } from "./read-file.ts";
export { parseStatement } from "./parse-statement.ts";
export type { StatementParse } from "./parse-statement.ts";
