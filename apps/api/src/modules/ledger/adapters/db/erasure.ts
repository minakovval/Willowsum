import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";

/**
 * Erasure of one space's journal (NFR-12@PoC FR 3, ARC-11 «Видалення даних»; ADR-0013 option A). `db` logs in as
 * `ws_era_ledger`, the only role the append-only triggers let delete (migrations/0003_erasure.sql); the binding and
 * the row policy keep it in the space. The space's queue rows first (its «проводку записано» events and jobs,
 * migrations/0004_outbox.sql), then postings, entries and the chart of accounts (the keys between them), in one
 * transaction: the space's journal goes whole or not at all.
 */
export async function eraseHouseholdJournal(
  db: ModuleDatabase,
  householdId: string,
): Promise<{ postings: number; entries: number; accounts: number; events: number; jobs: number }> {
  return db.inHousehold(householdId, async (q) => {
    const del = async (table: string) =>
      (await q.query(`DELETE FROM ${table} WHERE household_id = $1`, [householdId])).rowCount ?? 0;
    const events = await del("outbox_events");
    const jobs = await del("jobs");
    const postings = await del("postings");
    const entries = await del("entries");
    const accounts = await del("accounts");
    return { postings, entries, accounts, events, jobs };
  });
}
