import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import type { AuditEntry, AuditStore, NewAuditRow, PlatformAuditEntry } from "../../application/index.ts";

interface Row {
  id: string;
  household_id: string;
  occurred_at: Date;
  actor_kind: NewAuditRow["actorKind"];
  actor_id: string | null;
  channel: string;
  entity_type: string;
  entity_id: string;
  action: string;
  changes: NewAuditRow["changes"];
}

const COLUMNS =
  "id, household_id, occurred_at, actor_kind, actor_id, channel, entity_type, entity_id, action, changes";

const toEntry = (r: Row): AuditEntry => ({
  id: r.id,
  householdId: r.household_id,
  occurredAt: r.occurred_at.toISOString(),
  actorKind: r.actor_kind,
  actorId: r.actor_id,
  channel: r.channel,
  entityType: r.entity_type,
  entityId: r.entity_id,
  action: r.action,
  changes: r.changes,
});

const PLATFORM_COLUMNS =
  "id, occurred_at, actor_kind, actor_id, channel, entity_type, entity_id, action, changes";

const toPlatformEntry = (r: Omit<Row, "household_id">): PlatformAuditEntry => ({
  id: r.id,
  occurredAt: r.occurred_at.toISOString(),
  actorKind: r.actor_kind,
  actorId: r.actor_id,
  channel: r.channel,
  entityType: r.entity_type,
  entityId: r.entity_id,
  action: r.action,
  changes: r.changes,
});

/** The logs in schema «audit»: tables `entries` (per household) and `platform_entries` (append-only; see the migrations). */
export function databaseAuditStore(db: ModuleDatabase): AuditStore {
  return {
    append: (householdId, row) =>
      db.inHousehold(householdId, async (q) => {
        const { rows } = await q.query<Row>(
          `INSERT INTO entries (household_id, actor_kind, actor_id, channel, entity_type, entity_id, action, changes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
          [
            q.householdId,
            row.actorKind,
            row.actorId,
            row.channel,
            row.entityType,
            row.entityId,
            row.action,
            JSON.stringify(row.changes),
          ],
        );
        return toEntry(rows[0]!);
      }),
    forEntity: (householdId, entityType, entityId) =>
      db.inHousehold(householdId, async (q) => {
        const { rows } = await q.query<Row>(
          `SELECT ${COLUMNS} FROM entries
            WHERE household_id = $1 AND entity_type = $2 AND entity_id = $3
            ORDER BY occurred_at, id`,
          [q.householdId, entityType, entityId],
        );
        return rows.map(toEntry);
      }),
    appendPlatform: (row) =>
      db.transaction(async (q) => {
        const { rows } = await q.query<Omit<Row, "household_id">>(
          `INSERT INTO platform_entries (actor_kind, actor_id, channel, entity_type, entity_id, action, changes)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${PLATFORM_COLUMNS}`,
          [
            row.actorKind,
            row.actorId,
            row.channel,
            row.entityType,
            row.entityId,
            row.action,
            JSON.stringify(row.changes),
          ],
        );
        return toPlatformEntry(rows[0]!);
      }),
    platformForEntity: (entityType, entityId) =>
      db.transaction(async (q) => {
        const { rows } = await q.query<Omit<Row, "household_id">>(
          `SELECT ${PLATFORM_COLUMNS} FROM platform_entries
            WHERE entity_type = $1 AND entity_id = $2
            ORDER BY occurred_at, id`,
          [entityType, entityId],
        );
        return rows.map(toPlatformEntry);
      }),
  };
}
