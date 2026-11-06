import { auditEntryInput, maskChanges, type StoredChange } from "../domain/index.ts";

/** A row as appended to the log (sensitive values already masked). */
export interface NewAuditRow {
  readonly actorKind: "user" | "staff" | "system";
  readonly actorId: string | null;
  readonly channel: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  readonly changes: readonly StoredChange[];
}

export interface AuditEntry extends NewAuditRow {
  readonly id: string;
  readonly householdId: string;
  /** UTC, ISO 8601. */
  readonly occurredAt: string;
}

/** Port: append-only storage of one household's log. */
export interface AuditStore {
  append(householdId: string, row: NewAuditRow): Promise<AuditEntry>;
  forEntity(householdId: string, entityType: string, entityId: string): Promise<AuditEntry[]>;
}

/** Records one entry: validates the input and masks sensitive values before anything is stored. */
export async function recordEntry(
  store: AuditStore,
  householdId: string,
  input: unknown,
): Promise<AuditEntry> {
  const entry = auditEntryInput.parse(input);
  return store.append(householdId, {
    actorKind: entry.actor.kind,
    actorId: entry.actor.kind === "system" ? null : entry.actor.id,
    channel: entry.channel,
    entityType: entry.entity.type,
    entityId: entry.entity.id,
    action: entry.action,
    changes: maskChanges(entry.changes),
  });
}
