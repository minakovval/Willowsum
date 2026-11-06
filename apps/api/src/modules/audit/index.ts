// Public interface of the audit module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import { databaseAuditStore } from "./adapters/index.ts";
import { recordEntry, type AuditEntry } from "./application/index.ts";
import type { AuditEntryInput } from "./domain/index.ts";

export const auditModule = defineModule({
  name: "audit",
  publishes: [],
  consumes: [],
});

export type { AuditEntry } from "./application/index.ts";
export { AUDIT_MASK } from "./domain/index.ts";
export type { AuditChange, AuditEntryInput } from "./domain/index.ts";

/** The household's audit log (ARC-03 FR 5, П-10): append an entry; read the entries of one entity. */
export interface AuditLog {
  record(householdId: string, entry: AuditEntryInput): Promise<AuditEntry>;
  entriesFor(householdId: string, entity: { type: string; id: string }): Promise<AuditEntry[]>;
}

/** `db` is the audit module's own database (`ModuleDatabases.for("audit")`). */
export function createAuditLog(db: ModuleDatabase): AuditLog {
  const store = databaseAuditStore(db);
  return {
    record: (householdId, entry) => recordEntry(store, householdId, entry),
    entriesFor: (householdId, entity) => store.forEntity(householdId, entity.type, entity.id),
  };
}
