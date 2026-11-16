import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/**
 * Erasure of a space's merchants (NFR-12@PoC FR 3): the merchants and the queue rows (migrations/0002_queue.sql), in
 * one transaction of the module's own role. The merchants that joined another go first (their pointer).
 */
export async function eraseHouseholdMerchants(
  db: ModuleDatabase,
  householdId: string,
): Promise<{ readonly merchants: number; readonly jobs: number }> {
  return db.inHousehold(householdId, async (q) => {
    const joined = await q.query(
      `DELETE FROM merchants WHERE household_id = $1 AND merged_into IS NOT NULL`,
      [householdId],
    );
    const rest = await q.query(`DELETE FROM merchants WHERE household_id = $1`, [householdId]);
    const jobs = await q.query(`DELETE FROM jobs WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM outbox_events WHERE household_id = $1`, [householdId]);
    return { merchants: (joined.rowCount ?? 0) + (rest.rowCount ?? 0), jobs: jobs.rowCount ?? 0 };
  });
}
