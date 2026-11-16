import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/**
 * Erasure of a space's categorization (NFR-12@PoC FR 3): the categories of its transactions, its category rules
 * (BUD-14 b) and the queue rows
 * (migrations/0002_queue.sql), in one transaction of the module's own role.
 */
export async function eraseHouseholdCategorization(
  db: ModuleDatabase,
  householdId: string,
): Promise<{ readonly transactionCategories: number; readonly jobs: number }> {
  return db.inHousehold(householdId, async (q) => {
    const rows = await q.query(`DELETE FROM transaction_categories WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM rules WHERE household_id = $1`, [householdId]);
    const jobs = await q.query(`DELETE FROM jobs WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM outbox_events WHERE household_id = $1`, [householdId]);
    return { transactionCategories: rows.rowCount ?? 0, jobs: jobs.rowCount ?? 0 };
  });
}
