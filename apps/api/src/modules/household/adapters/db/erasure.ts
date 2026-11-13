import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/** The spaces an account belongs to, with how many members each has (the erasure, ADR-0013). */
export async function spacesOfAccount(
  db: ModuleDatabase,
  accountId: string,
): Promise<{ householdId: string; members: number }[]> {
  return db.transaction(async (q) => {
    const { rows } = await q.query<{ space_id: string; members: number }>(
      `SELECT m.space_id, (SELECT count(*)::int FROM account_spaces o WHERE o.space_id = m.space_id) AS members
         FROM account_spaces m WHERE m.account_id = $1 ORDER BY m.space_id`,
      [accountId],
    );
    return rows.map((r) => ({ householdId: r.space_id, members: r.members }));
  });
}
