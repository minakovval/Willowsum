import type { HouseholdQueryRunner, ModuleDatabase } from "../../../../platform/db/module-db.ts";
import type { Batch, BatchesTx, BatchFile, SpaceTx } from "../../application/index.ts";
import type { BatchState } from "../../domain/index.ts";
import { enqueueHandOff } from "../queue/job.ts";

interface BatchRow {
  household_id: string;
  id: string;
  name: string | null;
  state: BatchState;
  created_by: string;
  version: number;
  created_at: Date;
  last_action_at: Date;
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
  created_at: Date;
}

const BATCH = "household_id, id, name, state, created_by, version, created_at, last_action_at";
const FILE = "id, batch_id, position, file_name, file_id, format, size_bytes, rejection_code, created_at";

const batch = (r: BatchRow): Batch => ({
  householdId: r.household_id,
  id: r.id,
  name: r.name,
  state: r.state,
  createdBy: r.created_by,
  version: r.version,
  createdAt: r.created_at,
  lastActionAt: r.last_action_at,
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
  createdAt: r.created_at,
});

/** The batches of the transaction's space; every statement names the space too (row policies hold it anyway). */
export function batchesTx(q: HouseholdQueryRunner): BatchesTx {
  const h = q.householdId;
  const one = async (sql: string, values: unknown[]) => {
    const { rows } = await q.query<BatchRow>(sql, values);
    return rows[0] ? batch(rows[0]) : null;
  };
  return {
    async insertBatch(b) {
      await q.query(
        `INSERT INTO batches (household_id, id, name, state, created_by, version, created_at, last_action_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [h, b.id, b.name, b.state, b.createdBy, b.version, b.createdAt, b.lastActionAt],
      );
    },
    // A batch marked for deletion (FR 12, FR 20) is «not found» to every step.
    lockBatch: (id) =>
      one(
        `SELECT ${BATCH} FROM batches WHERE household_id = $1 AND id = $2 AND deleting_at IS NULL FOR UPDATE`,
        [h, id],
      ),
    findBatch: (id) =>
      one(`SELECT ${BATCH} FROM batches WHERE household_id = $1 AND id = $2 AND deleting_at IS NULL`, [
        h,
        id,
      ]),
    async listBatches(limit, after) {
      const { rows } = await q.query<BatchRow>(
        `SELECT ${BATCH} FROM batches WHERE household_id = $1 AND deleting_at IS NULL
           AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
         ORDER BY created_at DESC, id DESC LIMIT $4`,
        [h, after?.createdAt ?? null, after?.id ?? null, limit],
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
        `INSERT INTO batch_files (household_id, ${FILE}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
         ORDER BY last_action_at, id LIMIT $3`,
        [h, before, limit],
      );
      return rows.map((r) => r.id);
    },
    async deletingBatches(limit) {
      const { rows } = await q.query<{ id: string }>(
        `SELECT id FROM batches WHERE household_id = $1 AND deleting_at IS NOT NULL ORDER BY deleting_at, id LIMIT $2`,
        [h, limit],
      );
      return rows.map((r) => r.id);
    },
    enqueueHandOff: (handOff) => enqueueHandOff(q, handOff),
  };
}

/** A transaction of the module's database bound to one space. */
export function spaceTx(db: Pick<ModuleDatabase, "inHousehold">, householdId: string): SpaceTx {
  return (work) => db.inHousehold(householdId, (q) => work(batchesTx(q)));
}
