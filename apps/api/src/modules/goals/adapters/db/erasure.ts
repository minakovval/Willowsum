import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/**
 * Erasure of a space's goals (NFR-12@PoC FR 3): every goal with its contributions, the idempotency keys and the queue
 * rows, in one transaction of the module's own role.
 */
export async function eraseHouseholdGoals(
  db: ModuleDatabase,
  householdId: string,
): Promise<{ readonly goals: number; readonly contributions: number; readonly jobs: number }> {
  return db.inHousehold(householdId, async (q) => {
    const contributions = await q.query(`DELETE FROM contributions WHERE household_id = $1`, [householdId]);
    const goals = await q.query(`DELETE FROM goals WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM idempotency_keys WHERE household_id = $1`, [householdId]);
    const jobs = await q.query(`DELETE FROM jobs WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM outbox_events WHERE household_id = $1`, [householdId]);
    return {
      goals: goals.rowCount ?? 0,
      contributions: contributions.rowCount ?? 0,
      jobs: jobs.rowCount ?? 0,
    };
  });
}
