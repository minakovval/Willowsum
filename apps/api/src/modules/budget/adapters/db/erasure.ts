import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/**
 * Erasure of a space's budget (NFR-12@PoC FR 3): the budget with its limits, income plans, the plan's cells, account choices and snapshots, the
 * idempotency keys and the queue rows, in one transaction of the module's own role.
 */
export async function eraseHouseholdBudget(
  db: ModuleDatabase,
  householdId: string,
): Promise<{ readonly budgets: number; readonly snapshots: number; readonly jobs: number }> {
  return db.inHousehold(householdId, async (q) => {
    const snapshots = await q.query(`DELETE FROM period_snapshots WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM limits WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM income_plans WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM plan_cells WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM budget_accounts WHERE household_id = $1`, [householdId]);
    const budgets = await q.query(`DELETE FROM budgets WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM idempotency_keys WHERE household_id = $1`, [householdId]);
    const jobs = await q.query(`DELETE FROM jobs WHERE household_id = $1`, [householdId]);
    await q.query(`DELETE FROM outbox_events WHERE household_id = $1`, [householdId]);
    return {
      budgets: budgets.rowCount ?? 0,
      snapshots: snapshots.rowCount ?? 0,
      jobs: jobs.rowCount ?? 0,
    };
  });
}
