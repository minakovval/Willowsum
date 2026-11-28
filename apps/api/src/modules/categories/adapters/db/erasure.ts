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
  readonly labelMappings: number;
}> {
  return db.inHousehold(householdId, async (q) => {
    const count = async (sql: string) => (await q.query(sql, [householdId])).rowCount ?? 0;
    // BUD-21 FR 25: the matchings of labels first (they refer to the categories).
    const labelMappings = await count(`DELETE FROM history_label_mappings WHERE household_id = $1`);
    // One statement takes every category, so a merged one and its target go together.
    const categories = await count(`DELETE FROM categories WHERE household_id = $1`);
    const groups = await count(`DELETE FROM category_groups WHERE household_id = $1`);
    const idempotencyKeys = await count(`DELETE FROM idempotency_keys WHERE household_id = $1`);
    const events = await count(`DELETE FROM outbox_events WHERE household_id = $1`);
    const jobs = await count(`DELETE FROM jobs WHERE household_id = $1`);
    return { categories, groups, idempotencyKeys, events, jobs, labelMappings };
  });
}
