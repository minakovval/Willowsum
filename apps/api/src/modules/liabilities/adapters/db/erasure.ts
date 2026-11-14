import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/** Erasure of a space's liabilities (NFR-12@PoC FR 3), in one transaction of the module's own role. */
export async function eraseHouseholdLiabilities(
  db: ModuleDatabase,
  householdId: string,
): Promise<{ readonly liabilities: number }> {
  return db.inHousehold(householdId, async (q) => {
    const { rowCount } = await q.query(`DELETE FROM liabilities WHERE household_id = $1`, [householdId]);
    return { liabilities: rowCount ?? 0 };
  });
}
