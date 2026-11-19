import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/**
 * Erasure of a space's recipes (NFR-12@PoC FR 3): every recipe with its sealed account value, the idempotency keys and
 * the queue rows, in one transaction of the module's own role.
 */
export async function eraseHouseholdRecipes(
  db: ModuleDatabase,
  householdId: string,
): Promise<{ readonly recipes: number; readonly jobs: number }> {
  return db.inHousehold(householdId, async (q) => {
    const recipes = await q.query(`DELETE FROM recipes WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM idempotency_keys WHERE household_id = $1`, [householdId]);
    const jobs = await q.query(`DELETE FROM jobs WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM outbox_events WHERE household_id = $1`, [householdId]);
    return { recipes: recipes.rowCount ?? 0, jobs: jobs.rowCount ?? 0 };
  });
}
