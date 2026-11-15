import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { accountsTx } from "./adapters/db/store.ts";

/**
 * FIN-12@PoC FR 11 (#244 item 2): the first level of the data-access rule in the accounts store — its own `household_id`
 * filters (`lockAccount`, `updateDetails`, `duplicateCandidates`) — on a connection that bypasses row-level security
 * (the throw-away database's owner), so the SQL filter is proved without the second level. Names and numbers are synthetic.
 */
let db: RealModulesDatabase;
const mine = randomUUID();
const other = randomUUID();
const accountId = randomUUID();

/** The store on the owner connection: no row policy, only the store's own filters. */
async function store<T>(work: (tx: ReturnType<typeof accountsTx>) => Promise<T>): Promise<T> {
  const owner = db.owner as unknown as {
    query: (text: string, values?: readonly unknown[]) => Promise<never>;
  };
  await owner.query("SET search_path TO accounts");
  try {
    return await work(accountsTx(owner as never));
  } finally {
    await owner.query("RESET search_path");
  }
}

const stored = async () =>
  (
    await db.owner.query(
      `SELECT note, institution_key, number_last4 FROM accounts.accounts WHERE household_id = $1 AND id = $2`,
      [mine, accountId],
    )
  ).rows[0] as { note: string | null; institution_key: string; number_last4: string };

beforeAll(async () => {
  db = await setupRealModules(2);
  await db.owner.query(
    `INSERT INTO accounts.accounts (household_id, id, kind, name, institution_name, institution_country, institution_key,
       number_last4, note, opened_on)
     VALUES ($1, $2, 'current', 'Синтетичний', 'Банк', 'UA', 'UA:банк', '1234', 'Нотатка', '2026-01-01')`,
    [mine, accountId],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("FIN-12@PoC FR 11: the store's own household filters, without row-level security", () => {
  it("FIN-12@PoC FR 11: lockAccount of another household finds nothing", async () => {
    expect(await store((tx) => tx.lockAccount(other, accountId))).toBeNull();
    expect((await store((tx) => tx.lockAccount(mine, accountId)))?.id).toBe(accountId);
  });

  it("FIN-12@PoC FR 11: updateDetails of another household changes no row", async () => {
    const account = await store((tx) => tx.account(mine, accountId));
    if (!account) throw new Error("no account");
    await store((tx) => tx.updateDetails(other, { ...account, note: "Чужа зміна" }));
    expect((await stored()).note).toBe("Нотатка");
  });

  it("FIN-12@PoC FR 11: duplicateCandidates of another household does not see the account", async () => {
    const { institution_key, number_last4 } = await stored();
    expect(await store((tx) => tx.duplicateCandidates(other, institution_key, number_last4))).toEqual([]);
    const own = await store((tx) => tx.duplicateCandidates(mine, institution_key, number_last4));
    expect(own.map((c) => c.id)).toEqual([accountId]);
  });
});
