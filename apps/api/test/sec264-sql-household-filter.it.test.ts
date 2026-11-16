import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { transactionsTx } from "../src/modules/transactions/adapters/db/store.ts";
import type { NewStoredTransaction } from "../src/modules/transactions/application/index.ts";
import type { ModuleQueryRunner } from "../src/platform/db/module-db.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security (#264 item 6): the SQL of the transactions store filters by `household_id` itself, not only through the
 * row policy. The store runs on the owner's connection, which the policy does not bind, with another space's ids: no
 * statement finds, locks, changes, deletes or counts a row of another space. Synthetic ids and amounts.
 */
let db: RealModulesDatabase;
beforeAll(async () => {
  db = await setupRealModules(3);
});
afterAll(async () => {
  await db?.close();
});

const row = (id: string): NewStoredTransaction => ({
  id,
  accountId: randomUUID(),
  subaccountId: randomUUID(),
  amount: Money.of("-10.00", "EUR"),
  date: "2026-10-10",
  counterparty: null,
  description: null,
  status: "posted",
  source: "manual",
  hidden: false,
  split: null,
  transfer: null,
  mergedInto: null,
  note: null,
  tagIds: [],
  version: 1,
});

describe("sec264: the transactions store's own household filter (without the row policy)", () => {
  it("sec264: find, lock, update, remove, duplicatesOf and duplicatesForHiding of another space's transaction find and change nothing", async () => {
    const spaces = householdSpaces(db);
    const mine = (await spaces.ensureFirstSpace({ accountId: randomUUID(), displayName: "Олена Синтетична" }))
      .householdId;
    const theirs = (
      await spaces.ensureFirstSpace({ accountId: randomUUID(), displayName: "Богдан Синтетичний" })
    ).householdId;
    const id = randomUUID();
    const copy = randomUUID();
    await db.owner.query("BEGIN");
    try {
      await db.owner.query(`SET LOCAL search_path TO transactions, public`);
      const q = {
        query: (text: string, values?: readonly unknown[]) => db.owner.query(text, values as unknown[]),
      } as unknown as ModuleQueryRunner;
      const tx = transactionsTx(q);
      const first = row(id);
      await tx.insert(theirs, first);
      await tx.insert(theirs, { ...row(copy), accountId: first.accountId, subaccountId: first.subaccountId });
      // A duplicate of theirs merged into `id`, so `duplicatesOf` has a row to leak (#297 security review, M11).
      const merged = randomUUID();
      await tx.insert(theirs, {
        ...row(merged),
        accountId: first.accountId,
        subaccountId: first.subaccountId,
      });
      await db.owner.query(
        `UPDATE transactions.transactions SET hidden = true, merged_into = $2 WHERE household_id = $1 AND id = $3`,
        [theirs, id, merged],
      );
      expect(await tx.duplicatesOf(theirs, id)).toEqual([merged]);
      // My space asks for their ids.
      expect(await tx.find(mine, id)).toBeNull();
      expect(await tx.lock(mine, id)).toBeNull();
      expect(await tx.duplicatesOf(mine, id)).toEqual([]);
      expect(await tx.duplicatesForHiding(mine, id, first.accountId, 3)).toEqual([]);
      expect(await tx.update(mine, { ...first, hidden: true, version: 2 })).toBeNull();
      await tx.remove(mine, id);
      // Theirs is untouched, and as it was.
      const left = await tx.find(theirs, id);
      expect(left).toMatchObject({ id, hidden: false, version: 1 });
      expect(await tx.find(theirs, copy)).not.toBeNull();
    } finally {
      await db.owner.query("ROLLBACK");
    }
  });
});
