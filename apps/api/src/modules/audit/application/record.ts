import { auditEntryInput, maskChanges, platformEntryInput, type StoredChange } from "../domain/index.ts";

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

/** An entry of the platform log (no household). */
export interface PlatformAuditEntry extends NewAuditRow {
  readonly id: string;
  /** UTC, ISO 8601. */
  readonly occurredAt: string;
}

/**
 * ARC-04 FR 3 (#252 item 2): an entry's key is already the key of another entity's or another action's entry in the
 * space. Nothing is appended; the message names no key, entity or value.
 */
export class AuditKeyConflict extends Error {
  constructor() {
    super("The audit key is already used by an entry of another entity or action");
    this.name = "AuditKeyConflict";
  }
}

/** Port: append-only storage of one household's log, and of the platform log. */
export interface AuditStore {
  /**
   * With `key` (ARC-04 FR 3), the space's entry of that key if there is one — nothing is appended again; that entry of
   * another entity or action is `AuditKeyConflict`.
   */
  append(householdId: string, row: NewAuditRow, key?: string | null): Promise<AuditEntry>;
  /** Oldest first; with `limit`, the newest `limit` entries (still oldest first). */
  forEntity(householdId: string, entityType: string, entityId: string, limit?: number): Promise<AuditEntry[]>;
  appendPlatform(row: NewAuditRow): Promise<PlatformAuditEntry>;
  platformForEntity(entityType: string, entityId: string): Promise<PlatformAuditEntry[]>;
}

function toRow(entry: AuditEntryInputParsed): NewAuditRow {
  return {
    actorKind: entry.actor.kind,
    actorId: entry.actor.kind === "system" ? null : entry.actor.id,
    channel: entry.channel,
    entityType: entry.entity.type,
    entityId: entry.entity.id,
    action: entry.action,
    changes: maskChanges(entry.changes),
  };
}

type AuditEntryInputParsed = ReturnType<typeof auditEntryInput.parse>;

/** Records one entry: validates the input and masks sensitive values before anything is stored. */
export async function recordEntry(
  store: AuditStore,
  householdId: string,
  input: unknown,
): Promise<AuditEntry> {
  const entry = auditEntryInput.parse(input);
  return store.append(householdId, toRow(entry), entry.key ?? null);
}

/** Records one entry of the platform log (staff or system only), masking sensitive values first. */
export async function recordPlatformEntry(store: AuditStore, input: unknown): Promise<PlatformAuditEntry> {
  return store.appendPlatform(toRow(platformEntryInput.parse(input)));
}
