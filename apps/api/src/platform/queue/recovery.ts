import type { ModuleDatabase } from "../db/module-db.ts";

/**
 * Puts a space's dead jobs of one name back in the module's queue (ARC-04 FR 4; ADR-0015): a hand-off the worker gave
 * up on after 8 attempts is tried again from its first attempt, with an «error» event each time it is dead-lettered,
 * until it is done. Only for jobs whose every step is idempotent. Returns how many went back.
 */
export async function requeueDeadJobs(
  db: ModuleDatabase,
  householdId: string,
  name: string,
): Promise<number> {
  return db.inHousehold(householdId, async (q) => {
    const requeued = await q.query(
      `UPDATE jobs SET state = 'queued', attempts = 0, run_after = now(), finished_at = NULL,
              lease_owner = NULL, lease_until = NULL
        WHERE household_id = $1 AND name = $2 AND state = 'dead'`,
      [q.householdId, name],
    );
    return requeued.rowCount ?? 0;
  });
}
