import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { enqueueJob } from "../../../../platform/queue/index.ts";
import type { ItemRule, RunCounts, RunItem, RunRow, RunsTx } from "../../application/index.ts";
import type { CategorySource, RunStatus } from "../../domain/index.ts";
import { RULE_RUN_PART_JOB } from "../queue/job.ts";

/**
 * The runs of «Застосувати до N наявних транзакцій» (BUD-14@PoC FR 7; migrations/0004_rule_runs.sql) through the
 * module's own role. The row policy binds the space; SQL filters it too. Times are the application's clock (ms).
 */
interface RunDbRow {
  id: string;
  rule_id: string;
  actor_account_id: string;
  undo_actor_account_id: string | null;
  category_id: string;
  tags: string[];
  status: RunStatus;
  truncated: boolean;
  item_count: number;
  created_at: Date;
  ended_at: Date | null;
  derivation_id: string | null;
}

interface ItemDbRow {
  ordinal: number;
  transaction_id: string;
  result: RunItem["result"];
  category_changed: boolean;
  before_category_id: string | null;
  before_source: CategorySource | null;
  before_rule_id: string | null;
  after_version: number | null;
  tags_changed: boolean;
  tags_before: string[] | null;
  tags_after: string[] | null;
  before_tag_rule_id: string | null;
  rule_id: string | null;
  category_id: string | null;
  tag_rule_id: string | null;
  item_tags: string[] | null;
}

const RUN_COLUMNS = `id, rule_id, actor_account_id, undo_actor_account_id, category_id, tags, status, truncated,
                     item_count, created_at, ended_at, derivation_id`;
const ITEM_COLUMNS = `ordinal, transaction_id, result, category_changed, before_category_id, before_source,
                      before_rule_id, after_version, tags_changed, tags_before, tags_after, before_tag_rule_id,
                      rule_id, category_id, tag_rule_id, tags AS item_tags`;

const run = (r: RunDbRow): RunRow => ({
  id: r.id,
  ruleId: r.rule_id,
  actorAccountId: r.actor_account_id,
  undoActorAccountId: r.undo_actor_account_id,
  categoryId: r.category_id,
  tags: r.tags,
  status: r.status,
  truncated: r.truncated,
  count: r.item_count,
  createdAt: r.created_at.getTime(),
  endedAt: r.ended_at === null ? null : r.ended_at.getTime(),
  derivationId: r.derivation_id,
});

const item = (r: ItemDbRow): RunItem => ({
  ordinal: r.ordinal,
  transactionId: r.transaction_id,
  result: r.result,
  categoryChanged: r.category_changed,
  before:
    r.before_source === null
      ? null
      : { categoryId: r.before_category_id, source: r.before_source, ruleId: r.before_rule_id },
  afterVersion: r.after_version,
  tagsChanged: r.tags_changed,
  tagsBefore: r.tags_before,
  tagsAfter: r.tags_after,
  beforeTagRuleId: r.before_tag_rule_id,
  rule:
    r.rule_id === null || r.category_id === null
      ? null
      : { ruleId: r.rule_id, categoryId: r.category_id, tagRuleId: r.tag_rule_id, tags: r.item_tags ?? [] },
});

export function runsTx(q: HouseholdQueryRunner): RunsTx {
  return {
    async insertRun(householdId, r, transactionIds, rules?: readonly ItemRule[]) {
      const { rowCount } = await q.query(
        `INSERT INTO rule_runs (household_id, id, rule_id, actor_account_id, category_id, tags, status, truncated,
                                item_count, created_at, derivation_id)
         VALUES ($1, $2, $3, $4, $5, $6::text[], 'running', $7, $8, to_timestamp($9::double precision / 1000), $10)
         ON CONFLICT (household_id) WHERE status IN ('running', 'undoing') DO NOTHING`,
        [
          householdId,
          r.id,
          r.ruleId,
          r.actorAccountId,
          r.categoryId,
          r.tags,
          r.truncated,
          r.count,
          r.createdAt,
          r.derivationId ?? null,
        ],
      );
      if ((rowCount ?? 0) === 0) return false;
      if (rules === undefined)
        await q.query(
          `INSERT INTO rule_run_items (household_id, run_id, ordinal, transaction_id)
           SELECT $1, $2, o.n, o.id FROM unnest($3::uuid[]) WITH ORDINALITY AS o(id, n)`,
          [householdId, r.id, transactionIds],
        );
      // BUD-21 FR 22: each record with its own rules (an acceptance's run).
      else
        await q.query(
          `INSERT INTO rule_run_items (household_id, run_id, ordinal, transaction_id, rule_id, category_id, tag_rule_id,
                                       tags)
           SELECT $1, $2, o.n, o.transaction_id, o.rule_id, o.category_id, o.tag_rule_id, o.tags
             FROM jsonb_to_recordset($3::jsonb)
                  AS o(n int, transaction_id uuid, rule_id uuid, category_id uuid, tag_rule_id uuid, tags text[])`,
          [
            householdId,
            r.id,
            JSON.stringify(
              transactionIds.map((id, i) => ({
                n: i + 1,
                transaction_id: id,
                rule_id: rules[i]!.ruleId,
                category_id: rules[i]!.categoryId,
                tag_rule_id: rules[i]!.tagRuleId,
                tags: rules[i]!.tags,
              })),
            ),
          ],
        );
      return true;
    },
    async run(householdId, id) {
      const { rows } = await q.query<RunDbRow>(
        `SELECT ${RUN_COLUMNS} FROM rule_runs WHERE household_id = $1 AND id = $2`,
        [householdId, id],
      );
      return rows[0] ? run(rows[0]) : null;
    },
    async lockRun(householdId, id) {
      const { rows } = await q.query<RunDbRow>(
        `SELECT ${RUN_COLUMNS} FROM rule_runs WHERE household_id = $1 AND id = $2 FOR UPDATE`,
        [householdId, id],
      );
      return rows[0] ? run(rows[0]) : null;
    },
    async runs(householdId, limit) {
      const { rows } = await q.query<RunDbRow>(
        `SELECT ${RUN_COLUMNS} FROM rule_runs WHERE household_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
        [householdId, limit],
      );
      return rows.map(run);
    },
    async counts(householdId, id) {
      const { rows } = await q.query<Record<keyof RunCounts, number>>(
        `SELECT count(*) FILTER (WHERE result <> 'pending')::int AS processed,
                count(*) FILTER (WHERE category_changed OR tags_changed)::int AS changed,
                count(*) FILTER (WHERE result = 'manual')::int AS manual,
                count(*) FILTER (WHERE result = 'unchanged' AND NOT tags_changed)::int AS unchanged,
                count(*) FILTER (WHERE result = 'unavailable')::int AS unavailable,
                count(*) FILTER (WHERE undo_result = 'pending')::int AS "undoPending",
                count(*) FILTER (WHERE undo_result = 'restored')::int AS restored,
                count(*) FILTER (WHERE undo_result = 'not_restored')::int AS "notRestored"
           FROM rule_run_items WHERE household_id = $1 AND run_id = $2`,
        [householdId, id],
      );
      return rows[0]!;
    },
    async pending(householdId, id, limit) {
      const { rows } = await q.query<ItemDbRow>(
        `SELECT ${ITEM_COLUMNS} FROM rule_run_items
          WHERE household_id = $1 AND run_id = $2 AND result = 'pending' ORDER BY ordinal LIMIT $3`,
        [householdId, id, limit],
      );
      return rows.map(item);
    },
    async undoPending(householdId, id, limit) {
      const { rows } = await q.query<ItemDbRow>(
        `SELECT ${ITEM_COLUMNS} FROM rule_run_items
          WHERE household_id = $1 AND run_id = $2 AND undo_result = 'pending' ORDER BY ordinal LIMIT $3`,
        [householdId, id, limit],
      );
      return rows.map(item);
    },
    async saveItem(householdId, id, i) {
      await q.query(
        `UPDATE rule_run_items SET result = $4, category_changed = $5, before_category_id = $6, before_source = $7,
                                   before_rule_id = $8, after_version = $9, tags_changed = $10,
                                   tags_before = $11::text[], tags_after = $12::text[], before_tag_rule_id = $13
          WHERE household_id = $1 AND run_id = $2 AND ordinal = $3`,
        [
          householdId,
          id,
          i.ordinal,
          i.result,
          i.categoryChanged,
          i.before?.categoryId ?? null,
          i.before?.source ?? null,
          i.before?.ruleId ?? null,
          i.afterVersion,
          i.tagsChanged,
          i.tagsBefore,
          i.tagsAfter,
          i.beforeTagRuleId,
        ],
      );
    },
    async dropPending(householdId, id) {
      await q.query(
        `UPDATE rule_run_items SET result = 'unavailable'
          WHERE household_id = $1 AND run_id = $2 AND result = 'pending'`,
        [householdId, id],
      );
    },
    async saveUndo(householdId, id, ordinal, restored) {
      await q.query(
        `UPDATE rule_run_items SET undo_result = $4 WHERE household_id = $1 AND run_id = $2 AND ordinal = $3`,
        [householdId, id, ordinal, restored ? "restored" : "not_restored"],
      );
    },
    async startUndo(householdId, id, actorAccountId) {
      // One run at a time in a space: another running run makes the unique index refuse this one.
      await q.query(`SAVEPOINT rule_run_undo`);
      try {
        await q.query(
          `UPDATE rule_runs SET status = 'undoing', undo_actor_account_id = $3 WHERE household_id = $1 AND id = $2`,
          [householdId, id, actorAccountId],
        );
      } catch (error) {
        if ((error as { code?: string }).code !== "23505") throw error;
        await q.query(`ROLLBACK TO SAVEPOINT rule_run_undo`);
        return false;
      }
      await q.query(`RELEASE SAVEPOINT rule_run_undo`);
      await q.query(
        `UPDATE rule_run_items SET undo_result = 'pending'
          WHERE household_id = $1 AND run_id = $2 AND (category_changed OR tags_changed)`,
        [householdId, id],
      );
      return true;
    },
    async finish(householdId, id, status, at) {
      await q.query(
        `UPDATE rule_runs SET status = $3,
                ended_at = CASE WHEN $3 = 'completed' THEN to_timestamp($4::double precision / 1000) ELSE ended_at END,
                undone_at = CASE WHEN $3 = 'undone' THEN to_timestamp($4::double precision / 1000) ELSE undone_at END
          WHERE household_id = $1 AND id = $2`,
        [householdId, id, status, at],
      );
    },
    async enqueuePart(_householdId, id, status, step) {
      await enqueueJob(q, RULE_RUN_PART_JOB, `rule-run:${id}:${status}:${step}`, { runId: id });
    },
  };
}
