import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/**
 * Erasure of a space's liabilities (NFR-12@PoC FR 3): every liability and its queue rows (hand-off jobs,
 * migrations/0003_queue.sql), in one transaction of the module's own role.
 */
export async function eraseHouseholdLiabilities(
  db: ModuleDatabase,
  householdId: string,
): Promise<{ readonly liabilities: number; readonly jobs: number }> {
  return db.inHousehold(householdId, async (q) => {
    const liabilities = await q.query(`DELETE FROM liabilities WHERE household_id = $1`, [householdId]);
    const jobs = await q.query(`DELETE FROM jobs WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM outbox_events WHERE household_id = $1`, [householdId]);
    return { liabilities: liabilities.rowCount ?? 0, jobs: jobs.rowCount ?? 0 };
  });
}
