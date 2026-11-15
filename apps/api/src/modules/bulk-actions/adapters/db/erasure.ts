import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/**
 * Erasure of a space's bulk actions (NFR-12@PoC FR 3): every action with its records (their values before and after,
 * e.g. tags), the stored responses of its start requests and the queue rows, in one transaction of the module's own
 * role. The records themselves go with their own modules' erasure.
 */
export async function eraseHouseholdBulkActions(
  db: ModuleDatabase,
  householdId: string,
): Promise<{ readonly actions: number; readonly idempotencyKeys: number; readonly jobs: number }> {
  return db.inHousehold(householdId, async (q) => {
    await q.query(`DELETE FROM items WHERE household_id = $1`, [householdId]);
    const actions = await q.query(`DELETE FROM actions WHERE household_id = $1`, [householdId]);
    const keys = await q.query(`DELETE FROM idempotency_keys WHERE household_id = $1`, [householdId]);
    const jobs = await q.query(`DELETE FROM jobs WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM outbox_events WHERE household_id = $1`, [householdId]);
    return {
      actions: actions.rowCount ?? 0,
      idempotencyKeys: keys.rowCount ?? 0,
      jobs: jobs.rowCount ?? 0,
    };
  });
}
