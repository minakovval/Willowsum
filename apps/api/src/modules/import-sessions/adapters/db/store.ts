import type { HouseholdQueryRunner, ModuleDatabase } from "../../../../platform/db/module-db.ts";
import type {
  Batch,
  BatchFile,
  BatchKind,
  HistoryFileParse,
  HistoryTx,
  Decided,
  FileParse,
  FileReview,
  ApplyBatchesTx,
  ParseBatchesTx,
  RollbackTx,
  SpaceTx,
} from "../../application/index.ts";
import type { BatchState } from "../../domain/index.ts";
import {
  enqueueHandOff,
  enqueueHistoryParse,
  enqueueParse,
  PARSE_FILE_JOB,
  PARSE_HISTORY_JOB,
} from "../queue/job.ts";
import { applicationsTx } from "./applications.ts";

interface BatchRow {
  household_id: string;
  id: string;
  kind: BatchKind;
  name: string | null;
  state: BatchState;
  created_by: string;
  version: number;
  created_at: Date;
  last_action_at: Date;
  applying: boolean;
  applied_at: Date | null;
}

interface FileRow {
  id: string;
  batch_id: string;
  position: number;
  file_name: string;
  file_id: string | null;
  format: string | null;
  size_bytes: string | null;
  rejection_code: string | null;
  content_sha256: string | null;
  created_at: Date;
}

const BATCH = `household_id, id, kind, name, state, created_by, version, created_at, last_action_at,
  EXISTS (SELECT 1 FROM batch_applications a
           WHERE a.household_id = batches.household_id AND a.batch_id = batches.id AND a.in_progress) AS applying,
  (SELECT a.applied_at FROM batch_applications a
    WHERE a.household_id = batches.household_id AND a.batch_id = batches.id AND NOT a.in_progress) AS applied_at`;
const FILE =
  "id, batch_id, position, file_name, file_id, format, size_bytes, rejection_code, content_sha256, created_at";

const batch = (r: BatchRow): Batch => ({
  householdId: r.household_id,
  id: r.id,
  kind: r.kind,
  name: r.name,
  state: r.state,
  createdBy: r.created_by,
  version: r.version,
  createdAt: r.created_at,
  lastActionAt: r.last_action_at,
  applying: r.applying,
  appliedAt: r.applied_at,
});

const file = (r: FileRow): BatchFile => ({
  id: r.id,
  batchId: r.batch_id,
  position: r.position,
  fileName: r.file_name,
  fileId: r.file_id,
  format: r.format,
  sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
  rejectionCode: r.rejection_code,
  contentSha256: r.content_sha256,
  createdAt: r.created_at,
});

interface ReviewRow {
  batch_file_id: string;
  batch_id: string;
  account_id: string | null;
  account_currency: string | null;
  suggested_account_id: string | null;
  checks: FileReview["checks"];
  history: FileReview["history"];
  previous_file_id: string | null;
  recorded_at: Date;
}

const REVIEW =
  "batch_file_id, batch_id, account_id, account_currency, suggested_account_id, checks, history, previous_file_id, recorded_at";

const review = (r: ReviewRow): FileReview => ({
  batchFileId: r.batch_file_id,
  batchId: r.batch_id,
  accountId: r.account_id,
  accountCurrency: r.account_currency,
  suggestedAccountId: r.suggested_account_id,
  checks: r.checks,
  history: r.history,
  previousFileId: r.previous_file_id,
  recordedAt: r.recorded_at,
});

interface ParseRow {
  batch_file_id: string;
  batch_id: string;
  parse_id: string;
  recipe_id: string | null;
  used_recipe_id: string | null;
  recipe_format: FileParse["recipeFormat"];
  account_id: string | null;
  state: FileParse["state"];
  refusal_code: string | null;
  engine_version: string;
  rows_sealed: Buffer | null;
  row_count: number | null;
  requested_by: string;
  requested_at: Date;
  parsed_at: Date | null;
}

const PARSE =
  "batch_file_id, batch_id, parse_id, recipe_id, used_recipe_id, recipe_format, account_id, state, refusal_code, engine_version, rows_sealed, row_count, requested_by, requested_at, parsed_at";

const fileParse = (r: ParseRow): FileParse => ({
  batchFileId: r.batch_file_id,
  batchId: r.batch_id,
  parseId: r.parse_id,
  recipeId: r.recipe_id,
  usedRecipeId: r.used_recipe_id,
  recipeFormat: r.recipe_format,
  accountId: r.account_id,
  state: r.state,
  refusalCode: r.refusal_code,
  engineVersion: r.engine_version,
  rowsSealed: r.rows_sealed,
  rowCount: r.row_count,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at,
  parsedAt: r.parsed_at,
});

/**
 * Which batches a transaction sees (BUD-21 FR 3): the statements' routes and jobs only statements' batches — a history
 * file's batch is «not found» to them, so it is never parsed as a statement, applied or listed in the history of
 * imports; the history file's routes only history batches; the daily cleanup both.
 */
export type BatchScope = BatchKind | "any";

/** The batches of the transaction's space; every statement names the space too (row policies hold it anyway). */
export function batchesTx(q: HouseholdQueryRunner, scope: BatchScope = "statement"): ParseBatchesTx {
  const h = q.householdId;
  // $k: the scope's kind, null — any.
  const k = scope === "any" ? null : scope;
  const one = async (sql: string, values: unknown[]) => {
    const { rows } = await q.query<BatchRow>(sql, values);
    return rows[0] ? batch(rows[0]) : null;
  };
  return {
    async insertBatch(b) {
      await q.query(
        `INSERT INTO batches (household_id, id, kind, name, state, created_by, version, created_at, last_action_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          h,
          b.id,
          b.kind ?? "statement",
          b.name,
          b.state,
          b.createdBy,
          b.version,
          b.createdAt,
          b.lastActionAt,
        ],
      );
    },
    // A batch marked for deletion (FR 12, FR 20) is «not found» to every step.
    lockBatch: (id) =>
      one(
        `SELECT ${BATCH} FROM batches WHERE household_id = $1 AND id = $2 AND deleting_at IS NULL
           AND ($3::text IS NULL OR kind = $3) FOR UPDATE`,
        [h, id, k],
      ),
    findBatch: (id) =>
      one(
        `SELECT ${BATCH} FROM batches WHERE household_id = $1 AND id = $2 AND deleting_at IS NULL
           AND ($3::text IS NULL OR kind = $3)`,
        [h, id, k],
      ),
    async listBatches(limit, after) {
      const { rows } = await q.query<BatchRow>(
        `SELECT ${BATCH} FROM batches WHERE household_id = $1 AND deleting_at IS NULL
           AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
           AND ($5::text IS NULL OR kind = $5)
         ORDER BY created_at DESC, id DESC LIMIT $4`,
        [h, after?.createdAt ?? null, after?.id ?? null, limit, k],
      );
      return rows.map(batch);
    },
    async files(batchId) {
      const { rows } = await q.query<FileRow>(
        `SELECT ${FILE} FROM batch_files WHERE household_id = $1 AND batch_id = $2 ORDER BY position`,
        [h, batchId],
      );
      return rows.map(file);
    },
    async insertFile(f) {
      await q.query(
        `INSERT INTO batch_files (household_id, ${FILE}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          h,
          f.id,
          f.batchId,
          f.position,
          f.fileName,
          f.fileId,
          f.format,
          f.sizeBytes,
          f.rejectionCode,
          f.contentSha256,
          f.createdAt,
        ],
      );
    },
    async updateBatch(id, state, at) {
      const updated = await one(
        `UPDATE batches SET state = $3, version = version + 1, last_action_at = $4
         WHERE household_id = $1 AND id = $2 AND deleting_at IS NULL RETURNING ${BATCH}`,
        [h, id, state, at],
      );
      if (!updated) throw new Error("The batch is gone");
      return updated;
    },
    async markDeleting(id, at) {
      await q.query(`UPDATE batches SET deleting_at = $3 WHERE household_id = $1 AND id = $2`, [h, id, at]);
    },
    async deletingOriginals(id) {
      const { rows } = await q.query<{ file_id: string }>(
        `SELECT f.file_id FROM batch_files f
           JOIN batches b ON b.household_id = f.household_id AND b.id = f.batch_id
         WHERE f.household_id = $1 AND f.batch_id = $2 AND b.deleting_at IS NOT NULL AND f.file_id IS NOT NULL
         ORDER BY f.position`,
        [h, id],
      );
      return rows.map((r) => r.file_id);
    },
    async dropBatch(id) {
      // Only a marked batch; its files go with it (ON DELETE CASCADE).
      await q.query(`DELETE FROM batches WHERE household_id = $1 AND id = $2 AND deleting_at IS NOT NULL`, [
        h,
        id,
      ]);
    },
    async staleBatches(before, limit) {
      const { rows } = await q.query<{ id: string }>(
        `SELECT id FROM batches WHERE household_id = $1 AND deleting_at IS NULL
           AND state NOT IN ('applied', 'rolled-back') AND last_action_at < $2
           AND ($4::text IS NULL OR kind = $4)
         ORDER BY last_action_at, id LIMIT $3`,
        [h, before, limit, k],
      );
      return rows.map((r) => r.id);
    },
    async deletingBatches(limit) {
      const { rows } = await q.query<{ id: string }>(
        `SELECT id FROM batches WHERE household_id = $1 AND deleting_at IS NOT NULL
           AND ($3::text IS NULL OR kind = $3) ORDER BY deleting_at, id LIMIT $2`,
        [h, limit, k],
      );
      return rows.map((r) => r.id);
    },
    enqueueHandOff: (handOff) => enqueueHandOff(q, handOff),
    async upsertReview(r) {
      await q.query(
        `INSERT INTO file_checks (household_id, ${REVIEW}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (household_id, batch_file_id) DO UPDATE SET account_id = EXCLUDED.account_id,
           account_currency = EXCLUDED.account_currency, suggested_account_id = EXCLUDED.suggested_account_id,
           checks = EXCLUDED.checks, history = EXCLUDED.history, previous_file_id = EXCLUDED.previous_file_id,
           recorded_at = EXCLUDED.recorded_at`,
        [
          h,
          r.batchFileId,
          r.batchId,
          r.accountId,
          r.accountCurrency,
          r.suggestedAccountId,
          JSON.stringify(r.checks),
          JSON.stringify(r.history),
          r.previousFileId,
          r.recordedAt,
        ],
      );
    },
    async reviews(batchId) {
      const { rows } = await q.query<ReviewRow>(
        `SELECT ${REVIEW.split(", ")
          .map((c) => `c.${c}`)
          .join(", ")} FROM file_checks c
           JOIN batch_files f ON f.household_id = c.household_id AND f.id = c.batch_file_id
         WHERE c.household_id = $1 AND c.batch_id = $2 ORDER BY f.position`,
        [h, batchId],
      );
      return rows.map(review);
    },
    async previousStatement(accountId, batchId) {
      // FR 3: applied batches only (their apply finished); the latest end of period, then the batch's latest action.
      const { rows } = await q.query<{ batch_file_id: string; bounds: FileReview["checks"]["bounds"] }>(
        `SELECT c.batch_file_id, c.checks -> 'bounds' AS bounds FROM file_checks c
           JOIN batches b ON b.household_id = c.household_id AND b.id = c.batch_id
         WHERE c.household_id = $1 AND c.account_id = $2 AND c.batch_id <> $3
           AND b.state = 'applied' AND b.deleting_at IS NULL
           -- An apply still «in progress» is not an applied statement yet.
           AND NOT EXISTS (SELECT 1 FROM batch_applications a
                            WHERE a.household_id = b.household_id AND a.batch_id = b.id AND a.in_progress)
         ORDER BY c.checks -> 'bounds' ->> 'end' DESC NULLS LAST, b.last_action_at DESC, c.batch_file_id
         LIMIT 1`,
        [h, accountId, batchId],
      );
      return rows[0] ? { fileId: rows[0].batch_file_id, bounds: rows[0].bounds } : null;
    },
    async decisions(batchId, page) {
      const { rows } = await q.query<{
        slot: string;
        batch_file_id: string | null;
        decision: Decided["decision"];
        decided_by: string;
        decided_at: Date;
      }>(
        `SELECT slot, batch_file_id, decision, decided_by, decided_at FROM decisions
         WHERE household_id = $1 AND batch_id = $2 AND ($3::text IS NULL OR slot COLLATE "C" > $3)
           AND ($4::text[] IS NULL OR slot = ANY($4))
         ORDER BY slot COLLATE "C" LIMIT $5`,
        [h, batchId, page?.after ?? null, page?.slots ?? null, page?.limit ?? null],
      );
      return rows.map((r) => ({
        slot: r.slot,
        fileId: r.batch_file_id,
        decision: r.decision,
        decidedBy: r.decided_by,
        decidedAt: r.decided_at,
      }));
    },
    async upsertDecision(batchId, d) {
      await q.query(
        `INSERT INTO decisions (household_id, batch_id, slot, batch_file_id, decision, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (household_id, batch_id, slot) DO UPDATE SET batch_file_id = EXCLUDED.batch_file_id,
           decision = EXCLUDED.decision, decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at`,
        [h, batchId, d.slot, d.fileId, JSON.stringify(d.decision), d.decidedBy, d.decidedAt],
      );
    },
    async failedParses(batchId) {
      const { rows } = await q.query<{ batch_file_id: string }>(
        `SELECT batch_file_id FROM file_parses WHERE household_id = $1 AND batch_id = $2 AND state = 'failed'`,
        [h, batchId],
      );
      return rows.map((r) => r.batch_file_id);
    },
    async upsertParse(p) {
      await q.query(
        `INSERT INTO file_parses (household_id, ${PARSE})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (household_id, batch_file_id) DO UPDATE SET parse_id = EXCLUDED.parse_id,
           recipe_id = EXCLUDED.recipe_id, used_recipe_id = EXCLUDED.used_recipe_id,
           recipe_format = EXCLUDED.recipe_format, account_id = EXCLUDED.account_id, state = EXCLUDED.state,
           refusal_code = EXCLUDED.refusal_code, engine_version = EXCLUDED.engine_version,
           rows_sealed = EXCLUDED.rows_sealed, row_count = EXCLUDED.row_count, requested_by = EXCLUDED.requested_by,
           requested_at = EXCLUDED.requested_at, parsed_at = EXCLUDED.parsed_at`,
        [
          h,
          p.batchFileId,
          p.batchId,
          p.parseId,
          p.recipeId,
          p.usedRecipeId,
          p.recipeFormat,
          p.accountId,
          p.state,
          p.refusalCode,
          p.engineVersion,
          p.rowsSealed,
          p.rowCount,
          p.requestedBy,
          p.requestedAt,
          p.parsedAt,
        ],
      );
    },
    async parses(batchId) {
      const { rows } = await q.query<ParseRow>(
        `SELECT ${PARSE} FROM file_parses WHERE household_id = $1 AND batch_id = $2 ORDER BY batch_file_id`,
        [h, batchId],
      );
      return rows.map(fileParse);
    },
    async lockParse(batchFileId) {
      const { rows } = await q.query<ParseRow>(
        `SELECT ${PARSE} FROM file_parses WHERE household_id = $1 AND batch_file_id = $2 FOR UPDATE`,
        [h, batchFileId],
      );
      return rows[0] ? fileParse(rows[0]) : null;
    },
    enqueueParse: (job) => enqueueParse(q, job),
    async parsesInLastHour() {
      // One «Розібрати» of the space at a time from here to its commit: two batches at once would both read the
      // count before either queued its jobs and pass the ceiling together (security review of #639).
      await q.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('import-sessions.parse-rate:' || $1, 0))`,
        [h],
      );
      const { rows } = await q.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM jobs WHERE household_id = $1 AND name = ANY($2)
           AND created_at > now() - interval '1 hour'`,
        // BUD-21 FR 3: a history file's reads count against the same ceiling as a statement's.
        [h, [PARSE_FILE_JOB.name, PARSE_HISTORY_JOB.name]],
      );
      return rows[0]!.n;
    },
    async dropReview(batchId) {
      await q.query(`DELETE FROM decisions WHERE household_id = $1 AND batch_id = $2`, [h, batchId]);
      await q.query(`DELETE FROM file_checks WHERE household_id = $1 AND batch_id = $2`, [h, batchId]);
    },
    async dropDecisions(batchId, fileId) {
      await q.query(
        `DELETE FROM decisions WHERE household_id = $1 AND batch_id = $2
           AND (batch_file_id = $3 OR batch_file_id IS NULL)`,
        [h, batchId, fileId],
      );
    },
  };
}

interface HistoryRow {
  batch_id: string;
  batch_file_id: string;
  parse_id: string;
  state: HistoryFileParse["state"];
  refusal_code: string | null;
  engine_version: string;
  options: HistoryFileParse["options"];
  parse_sealed: Buffer | null;
  row_count: number | null;
  missing: string[];
  answers_sealed: Buffer | null;
  requested_by: string;
  requested_at: Date;
  parsed_at: Date | null;
  confirmed_by: string | null;
  confirmed_at: Date | null;
}

const HISTORY =
  "batch_id, batch_file_id, parse_id, state, refusal_code, engine_version, options, parse_sealed, row_count, missing, answers_sealed, requested_by, requested_at, parsed_at, confirmed_by, confirmed_at";

const historyParse = (r: HistoryRow): HistoryFileParse => ({
  batchId: r.batch_id,
  batchFileId: r.batch_file_id,
  parseId: r.parse_id,
  state: r.state,
  refusalCode: r.refusal_code,
  engineVersion: r.engine_version,
  options: r.options,
  parseSealed: r.parse_sealed,
  rowCount: r.row_count,
  missing: r.missing,
  answersSealed: r.answers_sealed,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at,
  parsedAt: r.parsed_at,
  confirmedBy: r.confirmed_by,
  confirmedAt: r.confirmed_at,
});

/** BUD-21 FR 3–6: the history files' batches of the transaction's space and their reads. */
export function historyTx(q: HouseholdQueryRunner): HistoryTx {
  const h = q.householdId;
  return {
    ...batchesTx(q, "history"),
    async historyParse(batchId, lock = false) {
      const { rows } = await q.query<HistoryRow>(
        `SELECT ${HISTORY} FROM history_parses WHERE household_id = $1 AND batch_id = $2${lock ? " FOR UPDATE" : ""}`,
        [h, batchId],
      );
      return rows[0] ? historyParse(rows[0]) : null;
    },
    async upsertHistoryParse(p) {
      await q.query(
        `INSERT INTO history_parses (household_id, ${HISTORY})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (household_id, batch_id) DO UPDATE SET batch_file_id = EXCLUDED.batch_file_id,
           parse_id = EXCLUDED.parse_id, state = EXCLUDED.state, refusal_code = EXCLUDED.refusal_code,
           engine_version = EXCLUDED.engine_version, options = EXCLUDED.options,
           parse_sealed = EXCLUDED.parse_sealed, row_count = EXCLUDED.row_count, missing = EXCLUDED.missing,
           answers_sealed = EXCLUDED.answers_sealed, requested_by = EXCLUDED.requested_by,
           requested_at = EXCLUDED.requested_at, parsed_at = EXCLUDED.parsed_at,
           confirmed_by = EXCLUDED.confirmed_by, confirmed_at = EXCLUDED.confirmed_at`,
        [
          h,
          p.batchId,
          p.batchFileId,
          p.parseId,
          p.state,
          p.refusalCode,
          p.engineVersion,
          JSON.stringify(p.options),
          p.parseSealed,
          p.rowCount,
          [...p.missing],
          p.answersSealed,
          p.requestedBy,
          p.requestedAt,
          p.parsedAt,
          p.confirmedBy,
          p.confirmedAt,
        ],
      );
    },
    enqueueHistoryParse: (job) => enqueueHistoryParse(q, job),
    async lockContent(sha256) {
      await q.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('import-sessions.history-content:' || $1 || ':' || $2, 0))`,
        [h, sha256],
      );
    },
    async historyByContent(sha256) {
      const { rows } = await q.query<{ id: string }>(
        `SELECT b.id FROM batch_files f
           JOIN batches b ON b.household_id = f.household_id AND b.id = f.batch_id
         WHERE f.household_id = $1 AND f.content_sha256 = $2 AND b.kind = 'history' AND b.deleting_at IS NULL
         ORDER BY b.created_at, b.id LIMIT 1`,
        [h, sha256],
      );
      return rows[0]?.id ?? null;
    },
    async historyBatches(ids) {
      const { rows } = await q.query<{ id: string }>(
        `SELECT id FROM batches WHERE household_id = $1 AND id = ANY($2::uuid[]) AND kind = 'history'
            AND deleting_at IS NULL`,
        [h, ids],
      );
      return new Set(rows.map((r) => r.id));
    },
  };
}

/** The batch's transaction with the stored result of its apply (application/apply.ts). */
export function applyTx(q: HouseholdQueryRunner): ApplyBatchesTx & RollbackTx {
  return { ...batchesTx(q), ...applicationsTx(q) };
}

/** A transaction of the module's database bound to one space. */
export function spaceTx(
  db: Pick<ModuleDatabase, "inHousehold">,
  householdId: string,
  scope: BatchScope = "statement",
): SpaceTx {
  return (work) => db.inHousehold(householdId, (q) => work(batchesTx(q, scope)));
}
