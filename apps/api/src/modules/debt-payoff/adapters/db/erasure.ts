import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/** Erasure of a space's debt payoff plans (NFR-12@PoC FR 3): the plans and the queue rows, in one transaction. */
export async function eraseHouseholdPlans(
  db: ModuleDatabase,
  householdId: string,
): Promise<{ readonly plans: number; readonly jobs: number }> {
  return db.inHousehold(householdId, async (q) => {
    const plans = await q.query(`DELETE FROM plans WHERE household_id = $1`, [householdId]);
    const jobs = await q.query(`DELETE FROM jobs WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM outbox_events WHERE household_id = $1`, [householdId]);
    return { plans: plans.rowCount ?? 0, jobs: jobs.rowCount ?? 0 };
  });
}
