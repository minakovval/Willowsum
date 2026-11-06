// Application layer of audit: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export { recordEntry } from "./record.ts";
export type { AuditEntry, AuditStore, NewAuditRow } from "./record.ts";
