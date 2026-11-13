import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLedgerErasure } from "../src/modules/ledger/index.ts";
import { personWithSpace, spaceRows, withTestErasureDatabases } from "./erasure-helpers.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of #184 (NFR-12@PoC FR 3, review of #174 item 1): the ledger's erasure deletes the space's queue
 * jobs too, not only its events. No ledger job exists yet in the product, so a job row is seeded here.
 */
let db: RealModulesDatabase;

beforeAll(async () => {
  db = await setupRealModules(3);
});

afterAll(async () => {
  await db?.close();
});

const seedJob = (householdId: string, key: string) =>
  db.owner.query(
    `INSERT INTO ledger.jobs (household_id, name, dedupe_key, payload, state, finished_at)
     VALUES ($1, 'ledger.sec184-probe', $2, '{"entryId": "x"}', 'done', now())`,
    [householdId, key],
  );

describe("sec184: erasure of the ledger's queue rows", () => {
  it("sec184: erasing a space deletes its ledger jobs and leaves the neighbour's jobs", async () => {
    const mine = await personWithSpace(db, "sec184-mine");
    const other = await personWithSpace(db, "sec184-other");
    await seedJob(mine.householdId, "k1");
    await seedJob(other.householdId, "k1");
    const otherBefore = await spaceRows(db, other.householdId);
    const result = await withTestErasureDatabases(db, (era) =>
      createLedgerErasure(era.for("ledger")).eraseHousehold(mine.householdId),
    );
    expect(result.jobs).toBe(1);
    expect((await spaceRows(db, mine.householdId))["ledger.jobs"]).toBe("0:");
    expect(await spaceRows(db, other.householdId)).toEqual(otherBefore);
  });
});
