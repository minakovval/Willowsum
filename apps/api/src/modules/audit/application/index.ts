// Application layer of audit: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export { recordEntry, recordPlatformEntry } from "./record.ts";
export type { AuditEntry, AuditStore, NewAuditRow, PlatformAuditEntry } from "./record.ts";
