// Public interface of the audit module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import { databaseAuditStore, eraseHouseholdLog } from "./adapters/index.ts";
import {
  recordEntry,
  recordPlatformEntry,
  type AuditEntry,
  type PlatformAuditEntry,
} from "./application/index.ts";
import type { AuditEntryInput, PlatformEntryInput } from "./domain/index.ts";

export const auditModule = defineModule({
  name: "audit",
  publishes: [],
  consumes: [],
});

export type { AuditEntry, PlatformAuditEntry } from "./application/index.ts";
export { AUDIT_MASK } from "./domain/index.ts";
export type { AuditChange, AuditEntryInput, PlatformEntryInput } from "./domain/index.ts";

/**
 * The audit log (ARC-03 FR 5, П-10): append an entry; read the entries of one entity. A household's log, and
 * the platform log for changes that belong to no household (feature flags, kill switches — CICD-06).
 */
export interface AuditLog {
  record(householdId: string, entry: AuditEntryInput): Promise<AuditEntry>;
  entriesFor(householdId: string, entity: { type: string; id: string }): Promise<AuditEntry[]>;
  /** Staff or system only. */
  recordPlatform(entry: PlatformEntryInput): Promise<PlatformAuditEntry>;
  platformEntriesFor(entity: { type: string; id: string }): Promise<PlatformAuditEntry[]>;
}

/** `db` is the audit module's own database (`ModuleDatabases.for("audit")`). */
export function createAuditLog(db: ModuleDatabase): AuditLog {
  const store = databaseAuditStore(db);
  return {
    record: (householdId, entry) => recordEntry(store, householdId, entry),
    entriesFor: (householdId, entity) => store.forEntity(householdId, entity.type, entity.id),
    recordPlatform: (entry) => recordPlatformEntry(store, entry),
    platformEntriesFor: (entity) => store.platformForEntity(entity.type, entity.id),
  };
}

/** Erasure of a space's log (NFR-12@PoC FR 3; ADR-0013): the owner's erasure script only. */
export interface AuditErasure {
  /** Deletes every entry of the space's own log (the platform log stays). Repeating it deletes nothing. */
  eraseHousehold(householdId: string): Promise<{ readonly entries: number }>;
}

/** `db` is audit's erasure database (`withErasureDatabases(…).for("audit")`, role `ws_era_audit`). */
export function createAuditErasure(db: ModuleDatabase): AuditErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdLog(db, householdId) };
}
