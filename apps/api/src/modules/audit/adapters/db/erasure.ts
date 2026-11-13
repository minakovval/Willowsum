import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/**
 * Erasure of one space's log (NFR-12@PoC FR 3; ADR-0013 option A). `db` logs in as `ws_era_audit`, the only role the
 * append-only triggers let delete (migrations/0003_erasure.sql); the binding and the row policy keep it in the space.
 */
export async function eraseHouseholdLog(
  db: ModuleDatabase,
  householdId: string,
): Promise<{ entries: number }> {
  return db.inHousehold(householdId, async (q) => {
    const { rowCount } = await q.query(`DELETE FROM entries WHERE household_id = $1`, [householdId]);
    return { entries: rowCount ?? 0 };
  });
}
