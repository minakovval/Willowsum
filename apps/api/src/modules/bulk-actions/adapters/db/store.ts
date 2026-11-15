import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import type { BulkStore, StoredAction, StoredItem } from "../../application/index.ts";
import type { ActionStatus, BulkValues, ItemOutcome, UndoOutcome } from "../../domain/index.ts";

/**
 * The bulk-actions schema through the module's own role (migrations/0001_bulk_actions.sql), in one transaction of the
 * caller's space: the row policy binds the space, and every statement filters it too.
 */

interface ActionRow {
  id: string;
  actor_id: string;
  action: string;
  entity: string;
  params: unknown;
  background: boolean;
  status: ActionStatus;
  run: number;
  record_count: number;
  created_at: Date;
  ended_at: Date | null;
  undone_at: Date | null;
}

interface ItemRow {
  position: number;
  record_id: string;
  version_before: number | null;
  before: BulkValues | null;
  after: BulkValues | null;
  outcome: ItemOutcome;
  issue: string | null;
  version_after: number | null;
  run: number | null;
  undo: UndoOutcome | null;
}

const ACTION_COLUMNS = `id, actor_id, action, entity, params, background, status, run, record_count, created_at, ended_at, undone_at`;
const ITEM_COLUMNS = `position, record_id, version_before, before, after, outcome, issue, version_after, run, undo`;
const UNIQUE_VIOLATION = "23505";

const time = (d: Date | null) => (d === null ? null : d.getTime());
const iso = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? null : new Date(ms).toISOString();

function actionOf(r: ActionRow): StoredAction {
  return {
    id: r.id,
    actorId: r.actor_id,
    action: r.action,
    entity: r.entity,
    params: r.params,
    background: r.background,
    status: r.status,
    run: r.run,
    count: r.record_count,
    createdAt: r.created_at.getTime(),
    endedAt: time(r.ended_at),
    undoneAt: time(r.undone_at),
  };
}

function itemOf(r: ItemRow): StoredItem {
  return {
    position: r.position,
    recordId: r.record_id,
    versionBefore: r.version_before,
    before: r.before,
    after: r.after,
    outcome: r.outcome,
    issue: r.issue,
    versionAfter: r.version_after,
    run: r.run,
    undo: r.undo,
  };
}

const isUniqueViolation = (error: unknown) => (error as { code?: unknown } | null)?.code === UNIQUE_VIOLATION;

export function bulkStore(q: HouseholdQueryRunner): BulkStore {
  const h = q.householdId;
  const findBy = async (actionId: string, lock: boolean) => {
    const { rows } = await q.query<ActionRow>(
      `SELECT ${ACTION_COLUMNS} FROM actions WHERE household_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
      [h, actionId],
    );
    return rows[0] ? actionOf(rows[0]) : null;
  };
  return {
    async insertAction(a, items) {
      const inserted = await q.query(
        `INSERT INTO actions (household_id, id, actor_id, action, entity, params, background, status, run, record_count,
                              created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
         ON CONFLICT DO NOTHING`,
        [
          h,
          a.id,
          a.actorId,
          a.action,
          a.entity,
          JSON.stringify(a.params ?? null),
          a.background,
          a.status,
          a.run,
          a.count,
          iso(a.createdAt),
        ],
      );
      if (inserted.rowCount !== 1) return false;
      await q.query(
        `INSERT INTO items (household_id, action_id, position, record_id, version_before, before, after, outcome, issue)
         SELECT $1, $2, x.position, x.record_id, x.version_before, x.before, x.after, x.outcome, x.issue
           FROM jsonb_to_recordset($3::jsonb)
             AS x(position integer, record_id uuid, version_before integer, before jsonb, after jsonb, outcome text,
                  issue text)`,
        [
          h,
          a.id,
          JSON.stringify(
            items.map((i) => ({
              position: i.position,
              record_id: i.recordId,
              version_before: i.versionBefore,
              before: i.before,
              after: i.after,
              outcome: i.outcome,
              issue: i.issue,
            })),
          ),
        ],
      );
      return true;
    },
    find: (actionId) => findBy(actionId, false),
    lock: (actionId) => findBy(actionId, true),
    async items(actionId) {
      const { rows } = await q.query<ItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM items WHERE household_id = $1 AND action_id = $2 ORDER BY position`,
        [h, actionId],
      );
      return rows.map(itemOf);
    },
    async pending(actionId, limit) {
      const { rows } = await q.query<ItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM items WHERE household_id = $1 AND action_id = $2 AND outcome = 'pending'
          ORDER BY position LIMIT $3`,
        [h, actionId, Number.isFinite(limit) ? limit : null],
      );
      return rows.map(itemOf);
    },
    async setOutcome(actionId, position, outcome, fields) {
      await q.query(
        `UPDATE items SET outcome = $4, issue = $5, version_after = $6, run = $7
          WHERE household_id = $1 AND action_id = $2 AND position = $3`,
        [
          h,
          actionId,
          position,
          outcome,
          fields.issue ?? null,
          fields.versionAfter ?? null,
          fields.run ?? null,
        ],
      );
    },
    async setUndo(actionId, position, undo) {
      await q.query(
        `UPDATE items SET undo = $4 WHERE household_id = $1 AND action_id = $2 AND position = $3`,
        [h, actionId, position, undo],
      );
    },
    async setStatus(actionId, status, fields) {
      try {
        await q.query(
          `UPDATE actions
              SET status = $3,
                  ended_at = CASE WHEN $4::boolean THEN $5::timestamptz ELSE ended_at END,
                  undone_at = coalesce($6::timestamptz, undone_at),
                  run = coalesce($7::integer, run)
            WHERE household_id = $1 AND id = $2`,
          [
            h,
            actionId,
            status,
            fields.endedAt !== undefined,
            iso(fields.endedAt),
            iso(fields.undoneAt),
            fields.run ?? null,
          ],
        );
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) return false;
        throw error;
      }
    },
    async hasRunning(actorId) {
      const { rows } = await q.query(
        `SELECT 1 FROM actions WHERE household_id = $1 AND actor_id = $2 AND status = 'running' LIMIT 1`,
        [h, actorId],
      );
      return rows.length > 0;
    },
  };
}
