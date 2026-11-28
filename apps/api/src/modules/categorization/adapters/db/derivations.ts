import type { z } from "zod";
import type { HouseholdQueryRunner, ModuleDatabase } from "../../../../platform/db/module-db.ts";
import { enqueueJob } from "../../../../platform/queue/index.ts";
import type {
  DerivationRun,
  DerivationsRun,
  DerivationsTx,
  DerivationStatus,
  StoredSuggestion,
} from "../../application/index.ts";
import type { SuggestionCondition, SuggestionKind } from "../../domain/index.ts";
import { AUDIT_JOB, HISTORY_DERIVATION_JOB } from "../queue/job.ts";

/**
 * The derivations of rules from history files (BUD-21@PoC FR 10–15; migrations/0005_history_derivations.sql) through
 * the module's own role. The row policy binds the space; SQL filters it too. Times are the application's clock (ms).
 */
interface RunDbRow {
  id: string;
  batch_id: string;
  actor_account_id: string;
  status: DerivationStatus;
  row_count: number;
  processed: number;
  created_at: Date;
  ended_at: Date | null;
}

interface SuggestionDbRow {
  ordinal: number;
  kind: SuggestionKind;
  conditions: SuggestionCondition[];
  category_id: string;
  matched: number;
  agreeing: number;
  since: string | null;
  tags: string[];
  evidence_rows: number[];
  exception_rows: number[];
}

const RUN_COLUMNS = `id, batch_id, actor_account_id, status, row_count, processed, created_at, ended_at`;

const run = (r: RunDbRow): DerivationRun => ({
  id: r.id,
  batchId: r.batch_id,
  actorAccountId: r.actor_account_id,
  status: r.status,
  count: r.row_count,
  processed: r.processed,
  createdAt: r.created_at.getTime(),
  endedAt: r.ended_at === null ? null : r.ended_at.getTime(),
});

/** Suggestions are written this many per statement (a run of 20 000 rows has a few thousand at most). */
const INSERT_CHUNK = 500;

export function derivationsTx(q: HouseholdQueryRunner): DerivationsTx {
  const one = async (sql: string, params: unknown[]) => {
    const { rows } = await q.query<RunDbRow>(sql, params);
    return rows[0] ? run(rows[0]) : null;
  };
  return {
    async lockBatch(householdId, batchId) {
      await q.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('categorization.history:' || $1 || ':' || $2, 0))`,
        [householdId, batchId],
      );
    },
    running: (householdId, batchId) =>
      one(
        `SELECT ${RUN_COLUMNS} FROM history_derivations
          WHERE household_id = $1 AND batch_id = $2 AND status = 'running'`,
        [householdId, batchId],
      ),
    latest: (householdId, batchId) =>
      one(
        `SELECT ${RUN_COLUMNS} FROM history_derivations WHERE household_id = $1 AND batch_id = $2
          ORDER BY created_at DESC, id DESC LIMIT 1`,
        [householdId, batchId],
      ),
    run: (householdId, id, lock = false) =>
      one(
        `SELECT ${RUN_COLUMNS} FROM history_derivations WHERE household_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
        [householdId, id],
      ),
    async insertRun(householdId, r) {
      await q.query(
        `INSERT INTO history_derivations (household_id, id, batch_id, actor_account_id, status, row_count, processed,
                                          created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          householdId,
          r.id,
          r.batchId,
          r.actorAccountId,
          r.status,
          r.count,
          r.processed,
          new Date(r.createdAt),
        ],
      );
    },
    async enqueueRun(_householdId, id) {
      await enqueueJob(q, HISTORY_DERIVATION_JOB, `history-derivation:${id}`, { derivationId: id });
    },
    async enqueueAudit(_householdId, handOff) {
      await enqueueJob(q, AUDIT_JOB, handOff.key, handOff as z.infer<typeof AUDIT_JOB.schema>);
    },
    async setProgress(householdId, id, processed) {
      await q.query(
        `UPDATE history_derivations SET processed = GREATEST(processed, LEAST($3, row_count))
          WHERE household_id = $1 AND id = $2 AND status = 'running'`,
        [householdId, id, processed],
      );
    },
    async finish(householdId, id, status, suggestions, at) {
      for (let i = 0; i < suggestions.length; i += INSERT_CHUNK) {
        const part = suggestions.slice(i, i + INSERT_CHUNK);
        await q.query(
          `INSERT INTO history_suggestions (household_id, derivation_id, ordinal, kind, conditions, category_id, matched,
                                            agreeing, since, tags, evidence_rows, exception_rows)
           SELECT $1, $2, s.ordinal, s.kind, s.conditions, s.category_id, s.matched, s.agreeing, s.since, s.tags,
                  s.evidence_rows, s.exception_rows
             FROM jsonb_to_recordset($3::jsonb) AS s(ordinal int, kind text, conditions jsonb, category_id uuid,
                  matched int, agreeing int, since date, tags text[], evidence_rows int[], exception_rows int[])`,
          [
            householdId,
            id,
            JSON.stringify(
              part.map((s, j) => ({
                ordinal: i + j + 1,
                kind: s.kind,
                conditions: s.conditions,
                category_id: s.categoryId,
                matched: s.matched,
                agreeing: s.agreeing,
                since: s.since,
                tags: s.tags,
                evidence_rows: s.rows,
                exception_rows: s.exceptions,
              })),
            ),
          ],
        );
      }
      await q.query(
        `UPDATE history_derivations
            SET status = $3, ended_at = $4, processed = CASE WHEN $3 = 'completed' THEN row_count ELSE processed END
          WHERE household_id = $1 AND id = $2`,
        [householdId, id, status, new Date(at)],
      );
    },
    async suggestions(householdId, derivationId) {
      const { rows } = await q.query<SuggestionDbRow>(
        `SELECT ordinal, kind, conditions, category_id, matched, agreeing, to_char(since, 'YYYY-MM-DD') AS since, tags,
                evidence_rows, exception_rows
           FROM history_suggestions WHERE household_id = $1 AND derivation_id = $2 ORDER BY ordinal`,
        [householdId, derivationId],
      );
      return rows.map((r): StoredSuggestion => ({
        ordinal: r.ordinal,
        kind: r.kind,
        conditions: r.conditions,
        categoryId: r.category_id,
        matched: r.matched,
        agreeing: r.agreeing,
        since: r.since,
        tags: r.tags,
        rows: r.evidence_rows,
        exceptions: r.exception_rows,
      }));
    },
    async batches(householdId) {
      const { rows } = await q.query<{ batch_id: string }>(
        `SELECT DISTINCT batch_id FROM history_derivations WHERE household_id = $1 ORDER BY batch_id`,
        [householdId],
      );
      return rows.map((r) => r.batch_id);
    },
    async forget(householdId, batchIds) {
      // The suggestions go with their derivation (ON DELETE CASCADE).
      const { rowCount } = await q.query(
        `DELETE FROM history_derivations WHERE household_id = $1 AND batch_id = ANY($2::uuid[])`,
        [householdId, batchIds],
      );
      return rowCount ?? 0;
    },
  };
}

/** Each unit of work in its own transaction of the module, bound to the space. */
export function derivationsRun(db: ModuleDatabase): DerivationsRun {
  return (householdId, work) => db.inHousehold(householdId, (q) => work(derivationsTx(q)));
}
