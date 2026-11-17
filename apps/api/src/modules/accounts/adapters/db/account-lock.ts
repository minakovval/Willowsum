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
 */
export async function lockAccounts(
  q: Pick<ModuleQueryRunner, "query">,
  householdId: string,
  accountIds: readonly string[],
): Promise<void> {
  for (const id of [...new Set(accountIds)].sort())
    await q.query(`SELECT pg_advisory_xact_lock(hashtextextended('accounts.money:' || $1 || ':' || $2, 0))`, [
      householdId,
      id,
    ]);
}
