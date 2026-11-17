import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";

/**
 * FIN-01@PoC EC4, FIN-12@PoC FR 7, FR 8, FR 14 (wave 2 row 198; #455, #409, #240, #290): the one lock of an account's
 * money, shared by every module that changes it — the accounts module's closing, «Оновити залишок», wallets and the
 * other changes of the account (with its row), and every write of module transactions on the account. A
 * transaction-scoped advisory lock, so each module takes it in its own transaction on its own connection, and no
 * module touches another's tables: the key is the space and the account. Two of them on one account run one after the
 * other; the second sees what the first committed (a closed account, a new transaction).
 *
 * Order (no deadlock): the accounts of one change are locked together, in the order of their ids; a module takes them
 * after its own row locks and takes no other lock of its own after them, so no cycle can form with the accounts' row
 * locks (taken after this lock, in the same order) or another module's rows.
 *
 * The wait is bounded (`LOCK_WAIT`): a holder may need a connection of another module's pool (transactions reads the
 * account's state through accounts' directory; a closing asks transactions' queue), and the waiters hold connections
 * of those pools while they wait — with as many waiters as a pool has connections, the holder could wait for good.
 * After `LOCK_WAIT` a waiter gives up (PostgreSQL 55P03, `lock_not_available`): its transaction is rolled back, nothing
 * is written, its connection goes back to the pool and the holder goes on; the request answers 500 (try again).
 */
export async function lockAccounts(
  q: Pick<ModuleQueryRunner, "query">,
  householdId: string,
  accountIds: readonly string[],
): Promise<void> {
  // One key and one order per account, whatever the letter case of the id a request sent (a uuid is read in both).
  const ids = [...new Set(accountIds.map((id) => id.toLowerCase()))].sort();
  if (ids.length === 0) return;
  const { rows } = await q.query<{ before: string }>(`SELECT current_setting('lock_timeout') AS before`);
  await q.query(`SELECT set_config('lock_timeout', $1, true)`, [LOCK_WAIT]);
  for (const id of ids)
    await q.query(`SELECT pg_advisory_xact_lock(hashtextextended('accounts.money:' || $1 || ':' || $2, 0))`, [
      householdId,
      id,
    ]);
  // The transaction's other lock waits as they were.
  await q.query(`SELECT set_config('lock_timeout', $1, true)`, [rows[0]!.before]);
}

/** How long a change waits for an account's money lock before it gives up (see `lockAccounts`). */
export const LOCK_WAIT = "5s";
