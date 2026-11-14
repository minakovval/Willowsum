import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/**
 * Erasure of a space's accounts (NFR-12@PoC FR 3): every account with its subaccounts and owners (ON DELETE CASCADE)
 * and the stored responses of its create requests, in one transaction of the module's own role (the tables are not
 * append-only). The sealed numbers are unreadable anyway once the space's key is destroyed (ARC-06 FR 5).
 */
export async function eraseHouseholdAccounts(
  db: ModuleDatabase,
  householdId: string,
): Promise<{ readonly accounts: number; readonly idempotencyKeys: number }> {
  return db.inHousehold(householdId, async (q) => {
    const accounts = await q.query(`DELETE FROM accounts WHERE household_id = $1`, [householdId]);
    const keys = await q.query(`DELETE FROM idempotency_keys WHERE household_id = $1`, [householdId]);
    return { accounts: accounts.rowCount ?? 0, idempotencyKeys: keys.rowCount ?? 0 };
  });
}
