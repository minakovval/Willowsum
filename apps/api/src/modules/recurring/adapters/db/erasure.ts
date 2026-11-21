import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/**
 * Erasure of a space's regular payments (NFR-12@PoC FR 3): every payment with its charges' marks, its holds (FR 13) and rejected series, the idempotency keys and
 * the queue rows, in one transaction of the module's own role. The queue rows go under their lock: a hand-off running
 * now finishes first, and one whose row is gone writes nothing.
 */
export async function eraseHouseholdRecurring(
  db: ModuleDatabase,
  householdId: string,
): Promise<{ readonly payments: number; readonly rejections: number; readonly jobs: number }> {
  return db.inHousehold(householdId, async (q) => {
    await q.query(`DELETE FROM charge_marks WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM payment_holds WHERE household_id = $1`, [householdId]);
    const payments = await q.query(`DELETE FROM payments WHERE household_id = $1`, [householdId]);
    const rejections = await q.query(`DELETE FROM rejections WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM idempotency_keys WHERE household_id = $1`, [householdId]);
    const jobs = await q.query(`DELETE FROM jobs WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM outbox_events WHERE household_id = $1`, [householdId]);
    return {
      payments: payments.rowCount ?? 0,
      rejections: rejections.rowCount ?? 0,
      jobs: jobs.rowCount ?? 0,
    };
  });
}
