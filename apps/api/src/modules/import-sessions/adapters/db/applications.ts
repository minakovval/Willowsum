import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import type { ApplicationResult, ApplicationTx, StoredApplication } from "../../application/index.ts";

interface Row {
  batch_id: string;
  result: ApplicationResult;
  applied_by: string;
  applied_at: Date;
  in_progress: boolean;
  from_state: "parsed" | "needs-review" | null;
}

const stored = (r: Row): StoredApplication => ({
  batchId: r.batch_id,
  result: r.result,
  appliedBy: r.applied_by,
  appliedAt: r.applied_at,
  inProgress: r.in_progress,
  fromState: r.from_state,
});

const COLUMNS = "batch_id, result, applied_by, applied_at, in_progress, from_state";

/** The stored results of applied batches and the same file of an applied batch (IMP-04@PoC FR 3, FR 7). */
export function applicationsTx(q: HouseholdQueryRunner): ApplicationTx & {
  find(batchId: string): Promise<StoredApplication | null>;
} {
  const h = q.householdId;
  const find = async (batchId: string): Promise<StoredApplication | null> => {
    const { rows } = await q.query<Row>(
      `SELECT ${COLUMNS} FROM batch_applications WHERE household_id = $1 AND batch_id = $2`,
      [h, batchId],
    );
    return rows[0] ? stored(rows[0]) : null;
  };
  return {
    /**
     * FR 3 (#637 comment item 4): an applied batch (other than this file's own, not being deleted, its apply finished)
     * with an accepted file of the same content as this batch file, applied to the same account; the earliest applied.
     * Null — none, or the file has no hash (uploaded before it). The caller checks the account is the caller's.
     */
    async sameFileApplied(batchFileId, accountId) {
      const { rows } = await q.query<{ batch_id: string }>(
        `SELECT e.batch_id
           FROM batch_files f
           JOIN batch_files e ON e.household_id = f.household_id AND e.content_sha256 = f.content_sha256
                             AND e.batch_id <> f.batch_id
           JOIN file_checks c ON c.household_id = e.household_id AND c.batch_file_id = e.id AND c.account_id = $3
           JOIN batches b ON b.household_id = e.household_id AND b.id = e.batch_id
           JOIN batch_applications a ON a.household_id = b.household_id AND a.batch_id = b.id AND NOT a.in_progress
          WHERE f.household_id = $1 AND f.id = $2 AND b.state = 'applied' AND b.deleting_at IS NULL
          ORDER BY b.last_action_at, b.id
          LIMIT 1`,
        [h, batchFileId, accountId],
      );
      return rows[0]?.batch_id ?? null;
    },
    find,
    application: find,
    async startApplication(a) {
      await q.query(
        `INSERT INTO batch_applications (household_id, batch_id, result, applied_by, applied_at, in_progress, from_state)
         VALUES ($1, $2, $3::jsonb, $4, $5, true, $6)`,
        [h, a.batchId, JSON.stringify(a.result), a.appliedBy, a.appliedAt, a.fromState],
      );
    },
    async finishApplication(batchId, result) {
      await q.query(
        `UPDATE batch_applications SET result = $3::jsonb, in_progress = false
          WHERE household_id = $1 AND batch_id = $2 AND in_progress`,
        [h, batchId, JSON.stringify(result)],
      );
    },
    async dropApplication(batchId) {
      await q.query(
        `DELETE FROM batch_applications WHERE household_id = $1 AND batch_id = $2 AND in_progress`,
        [h, batchId],
      );
    },
  };
}
export type ApplicationsTx = ReturnType<typeof applicationsTx>;
