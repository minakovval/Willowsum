import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import type { AuditEntry, AuditStore, NewAuditRow } from "../../application/index.ts";

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

/** The log in schema «audit», table `entries` (append-only; see the migration). */
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
  };
}
