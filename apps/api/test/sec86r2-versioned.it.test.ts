import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HouseholdQueryRunner } from "../src/platform/db/module-db.ts";
import { ApiProblem, problemBody } from "../src/platform/http/problem.ts";
import { defineVersionedTable, updateVersioned } from "../src/platform/http/versioned.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { householdA, householdB } from "./http.ts";

/**
 * Security review of PR #86, round 2 (NFR-15 FR 13, base semantics) on PostgreSQL under FORCE RLS as a
 * non-owner role: `base` cannot confirm a guessed value of a field outside `readable`, cannot inject SQL, and
 * a record of another space is the same 404 as a missing one, whatever base and version are sent.
 */
let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let app: pg.Client;
// Low-entropy throw-away password of a role that exists only in this test database.
const APP_PASSWORD = ["sec86r2", "app", "role"].join("-");

const SHARED_ID = "6e3f4d2b-9c8f-4d7e-8b1c-2f3a4b5c6d7e";
const ONLY_A_ID = "7f405e3c-ad90-4e8f-9c2d-3a4b5c6d7e8f";
const MISSING_ID = "80516f4d-bea1-4f90-8d3e-4b5c6d7e8f90";

const assets = defineVersionedTable({
  table: "sec86r2_assets",
  fields: { name: "name", note: "note", value: "value_amount" },
  // `note` is write-only for this caller: it is never compared.
  readable: ["name", "value"],
});

async function inHousehold<T>(
  householdId: string,
  work: (q: HouseholdQueryRunner) => Promise<T>,
): Promise<T> {
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('sec86r2.household', $1, true)", [householdId]);
    const result = await work({
      householdId,
      query: ((text: string, values?: readonly unknown[]) =>
        app.query(text, values as unknown[])) as HouseholdQueryRunner["query"],
    });
    await app.query("COMMIT");
    return result;
  } catch (error) {
    await app.query("ROLLBACK");
    throw error;
  }
}

const outcome = async (householdId: string, id: string, version: number, base: Record<string, unknown>) => {
  try {
    await inHousehold(householdId, (q) => updateVersioned(q, assets, id, version, { name: "attempt" }, base));
    return { applied: true } as const;
  } catch (error) {
    if (error instanceof ApiProblem)
      return { problem: problemBody(error.code, { extensions: error.extensions }) } as const;
    return { databaseError: (error as { code?: string }).code ?? "?" } as const;
  }
};

const stored = async (householdId: string, id: string) =>
  (
    await owner.query(
      "SELECT name, note, value_amount::text AS value, version FROM sec86r2_assets WHERE household_id = $1 AND id = $2",
      [householdId, id],
    )
  ).rows[0];

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  const role = `sec86r2_app_${Math.random().toString(36).slice(2, 8)}`;
  await owner.query(`CREATE ROLE ${role} LOGIN PASSWORD '${APP_PASSWORD}'`);
  await owner.query(`
    CREATE TABLE sec86r2_assets (
      household_id uuid NOT NULL,
      id uuid NOT NULL,
      version integer NOT NULL DEFAULT 1,
      name text NOT NULL,
      note text,
      value_amount numeric(38, 18),
      PRIMARY KEY (household_id, id)
    );
    ALTER TABLE sec86r2_assets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE sec86r2_assets FORCE ROW LEVEL SECURITY;
    CREATE POLICY household ON sec86r2_assets
      USING (household_id = current_setting('sec86r2.household', true)::uuid)
      WITH CHECK (household_id = current_setting('sec86r2.household', true)::uuid);`);
  await owner.query(`GRANT SELECT, UPDATE ON sec86r2_assets TO ${role}`);
  // Version 5 everywhere, so a client on version 4 always conflicts.
  await owner.query(
    `INSERT INTO sec86r2_assets (household_id, id, version, name, note, value_amount) VALUES
       ($1, $3, 5, 'A shared', 'zq-note-a', 100),
       ($2, $3, 5, 'B shared', 'zq-note-b', 7),
       ($1, $4, 5, 'A only', 'zq-note-only', 42)`,
    [householdA, householdB, SHARED_ID, ONLY_A_ID],
  );
  app = new pg.Client({ connectionString: urlAs(db.url, role, APP_PASSWORD) });
  await app.connect();
});

afterAll(async () => {
  await app?.end();
  await owner?.end();
  await db?.drop();
});

describe("NFR-15 FR 13 base (round 2): no oracle for a field the caller may not read", () => {
  it("a right and a wrong guess of the write-only note give the same answer; the guess never reaches SQL as a comparison", async () => {
    const right = await outcome(householdA, ONLY_A_ID, 4, { name: "A only", note: "zq-note-only" });
    const wrong = await outcome(householdA, ONLY_A_ID, 4, { name: "A only", note: "zq-wrong-guess" });
    expect(right).toEqual(wrong);
    expect(right).toMatchObject({
      problem: { code: "VERSION_CONFLICT", currentVersion: 5, changedFields: [] },
    });
    expect(await stored(householdA, ONLY_A_ID)).toMatchObject({ name: "A only", version: 5 });
  });

  it("a readable field left undefined in base is not compared (never «IS DISTINCT FROM NULL»)", async () => {
    expect(await outcome(householdA, ONLY_A_ID, 4, { name: undefined, value: "42" })).toMatchObject({
      problem: { changedFields: [] },
    });
  });
});

describe("NFR-15 FR 13 base (round 2): base is data, never SQL", () => {
  it("SQL-shaped keys are ignored and SQL-shaped values are compared as plain values", async () => {
    const answer = await outcome(householdA, ONLY_A_ID, 4, {
      'name" IS NULL OR TRUE OR "name': "x",
      name: "' OR 1=1 --",
      value: "42",
    });
    expect(answer).toMatchObject({ problem: { code: "VERSION_CONFLICT", changedFields: ["name"] } });
    expect(await stored(householdA, ONLY_A_ID)).toMatchObject({
      name: "A only",
      note: "zq-note-only",
      version: 5,
    });
  });
});

describe("NFR-15 FR 13 base (round 2): another space's record under FORCE RLS", () => {
  const bases: Record<string, unknown>[] = [
    {},
    { name: "A only", value: "42" },
    { name: "guess", value: "1" },
  ];

  it("A's id from space B (no such id in B) is the same 404 as a missing id — for any version and base, never 409", async () => {
    for (const version of [1, 4, 5, 6, 2_147_483_647])
      for (const base of bases) {
        const foreign = await outcome(householdB, ONLY_A_ID, version, base);
        const missing = await outcome(householdB, MISSING_ID, version, base);
        expect(foreign, `v${version} ${JSON.stringify(base)}`).toEqual(missing);
        expect(foreign).toMatchObject({ problem: { code: "NOT_FOUND" } });
      }
    expect(await stored(householdA, ONLY_A_ID)).toMatchObject({ name: "A only", version: 5 });
  });

  it("the same id in both spaces: B's conflict compares B's own row only (A's values never decide it)", async () => {
    // A's row has name «A shared», value 100; B's has «B shared», 7.
    expect(await outcome(householdB, SHARED_ID, 4, { name: "B shared", value: "7" })).toMatchObject({
      problem: { code: "VERSION_CONFLICT", currentVersion: 5, changedFields: [] },
    });
    expect(await outcome(householdB, SHARED_ID, 4, { name: "A shared", value: "100" })).toMatchObject({
      problem: { changedFields: ["name", "value"] },
    });
    expect(await stored(householdA, SHARED_ID)).toMatchObject({ name: "A shared", version: 5 });
  });

  it("a base value the column cannot hold fails the same way for a foreign and a missing id (no existence oracle)", async () => {
    // The route validates base with the change's schemas (documented); without that this is a database error.
    const foreign = await outcome(householdB, ONLY_A_ID, 4, { value: "zq-not-a-number" });
    const missing = await outcome(householdB, MISSING_ID, 4, { value: "zq-not-a-number" });
    expect(foreign).toEqual(missing);
  });
});

describe("NFR-15 FR 13 (round 2): the version's range", () => {
  it("the largest int4 version is a normal conflict, not a database error; one more is VALIDATION_FAILED", async () => {
    expect(await outcome(householdA, ONLY_A_ID, 2_147_483_647, {})).toMatchObject({
      problem: { code: "VERSION_CONFLICT" },
    });
    expect(await outcome(householdA, ONLY_A_ID, 2_147_483_648, {})).toMatchObject({
      problem: { code: "VALIDATION_FAILED" },
    });
    expect(await outcome(householdA, ONLY_A_ID, 0, {})).toMatchObject({
      problem: { code: "VERSION_CONFLICT" },
    });
  });
});
