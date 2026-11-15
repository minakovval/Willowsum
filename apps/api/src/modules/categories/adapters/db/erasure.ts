import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/**
 * Erasure of a space's categories (NFR-12@PoC FR 3): the tree, the custom categories, the stored responses of the
 * create requests and the module's events and jobs, in one transaction of the module's own role (the tables are not
 * append-only).
 */
export async function eraseHouseholdCategories(
  db: ModuleDatabase,
  householdId: string,
): Promise<{
  readonly categories: number;
  readonly groups: number;
  readonly idempotencyKeys: number;
  readonly events: number;
  readonly jobs: number;
}> {
  return db.inHousehold(householdId, async (q) => {
    const count = async (sql: string) => (await q.query(sql, [householdId])).rowCount ?? 0;
    // A merged category points to its target: the pointers go first.
    await q.query(`UPDATE categories SET merged_into = NULL WHERE household_id = $1`, [householdId]);
    const categories = await count(`DELETE FROM categories WHERE household_id = $1`);
    const groups = await count(`DELETE FROM category_groups WHERE household_id = $1`);
    const idempotencyKeys = await count(`DELETE FROM idempotency_keys WHERE household_id = $1`);
    const events = await count(`DELETE FROM outbox_events WHERE household_id = $1`);
    const jobs = await count(`DELETE FROM jobs WHERE household_id = $1`);
    return { categories, groups, idempotencyKeys, events, jobs };
  });
}
