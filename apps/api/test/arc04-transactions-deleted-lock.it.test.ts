import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { transactionRows } from "../src/modules/transactions/adapters/queue/hand-off.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * ARC-04@PoC FR 2 (#257 item 3): the hand-offs of a deleted transaction take turns — a deleted row has nothing to lock,
 * so the hand-off locks its id; before, two of them (the route's and the worker's) ran at once and one failed with a
 * temporary `LedgerError`. Real PostgreSQL, synthetic ids.
 */
let db: RealModulesDatabase;
beforeAll(async () => {
  db = await setupRealModules(3);
});
afterAll(async () => {
  await db?.close();
});

describe("ARC-04@PoC FR 2: two hand-offs of one deleted transaction do not run at once", () => {
  it("ARC-04@PoC FR 2: the second waits until the first has committed; another transaction's hand-off does not wait", async () => {
    const accountId = randomUUID();
    const { householdId } = await householdSpaces(db).ensureFirstSpace({
      accountId,
      displayName: "Олена Синтетична",
    });
    const rows = transactionRows((work) => db.databases.for("transactions").inHousehold(householdId, work));
    const gone = randomUUID();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const first = new Promise<void>((r) => (entered = r));
    const one = rows.whileLocked(householdId, gone, async (row) => {
      expect(row).toBeNull();
      events.push("one:in");
      entered();
      await gate;
      events.push("one:out");
    });
    await first;
    const two = rows.whileLocked(householdId, gone, async () => {
      events.push("two:in");
    });
    // Another deleted transaction is not held up by the first.
    await rows.whileLocked(householdId, randomUUID(), async () => {
      events.push("other");
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(events).toEqual(["one:in", "other"]);
    release();
    await Promise.all([one, two]);
    expect(events).toEqual(["one:in", "other", "one:out", "two:in"]);
  });
});
