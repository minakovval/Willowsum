import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/**
 * Erasure of a space's transactions (NFR-12@PoC FR 3): every transaction, the stored responses of its create requests
 * and its queue rows (hand-off jobs, migrations/0003_queue.sql), in one transaction of the module's own role (the
 * tables are not append-only). Their journal entries go with the ledger's own erasure.
 */
export async function eraseHouseholdTransactions(
  db: ModuleDatabase,
  householdId: string,
): Promise<{ readonly transactions: number; readonly idempotencyKeys: number; readonly jobs: number }> {
  return db.inHousehold(householdId, async (q) => {
    const transactions = await q.query(`DELETE FROM transactions WHERE household_id = $1`, [householdId]);
    const keys = await q.query(`DELETE FROM idempotency_keys WHERE household_id = $1`, [householdId]);
    const jobs = await q.query(`DELETE FROM jobs WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM outbox_events WHERE household_id = $1`, [householdId]);
    return {
      transactions: transactions.rowCount ?? 0,
      idempotencyKeys: keys.rowCount ?? 0,
      jobs: jobs.rowCount ?? 0,
    };
  });
}
