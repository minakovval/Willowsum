import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import type { ApplicationResult, StoredApplication } from "../../application/index.ts";

interface Row {
  batch_id: string;
  result: ApplicationResult;
  applied_by: string;
  applied_at: Date;
}

const stored = (r: Row): StoredApplication => ({
  batchId: r.batch_id,
  result: r.result,
  appliedBy: r.applied_by,
  appliedAt: r.applied_at,
});

/** The stored results of applied batches and the same file of an applied batch (IMP-04@PoC FR 3, FR 7). */
export function applicationsTx(q: HouseholdQueryRunner) {
  const h = q.householdId;
  return {
    /**
     * FR 3: an applied batch (other than this file's own, not being deleted) with an accepted file of the same
     * content as this batch file; the earliest applied. Null — none, or the file has no hash (uploaded before it).
     */
    async sameFileApplied(batchFileId: string): Promise<string | null> {
      const { rows } = await q.query<{ batch_id: string }>(
        `SELECT e.batch_id
           FROM batch_files f
           JOIN batch_files e ON e.household_id = f.household_id AND e.content_sha256 = f.content_sha256
                             AND e.batch_id <> f.batch_id
           JOIN batches b ON b.household_id = e.household_id AND b.id = e.batch_id
          WHERE f.household_id = $1 AND f.id = $2 AND b.state = 'applied' AND b.deleting_at IS NULL
          ORDER BY b.last_action_at, b.id
          LIMIT 1`,
        [h, batchFileId],
      );
      return rows[0]?.batch_id ?? null;
    },
    async find(batchId: string): Promise<StoredApplication | null> {
      const { rows } = await q.query<Row>(
        `SELECT batch_id, result, applied_by, applied_at FROM batch_applications
          WHERE household_id = $1 AND batch_id = $2`,
        [h, batchId],
      );
      return rows[0] ? stored(rows[0]) : null;
    },
    /** Inserts the result unless the batch has one; true — this call stored it. */
    async insert(application: StoredApplication): Promise<boolean> {
      const { rowCount } = await q.query(
        `INSERT INTO batch_applications (household_id, batch_id, result, applied_by, applied_at)
         VALUES ($1, $2, $3::jsonb, $4, $5) ON CONFLICT (household_id, batch_id) DO NOTHING`,
        [
          h,
          application.batchId,
          JSON.stringify(application.result),
          application.appliedBy,
          application.appliedAt,
        ],
      );
      return rowCount === 1;
    },
  };
}
export type ApplicationsTx = ReturnType<typeof applicationsTx>;
