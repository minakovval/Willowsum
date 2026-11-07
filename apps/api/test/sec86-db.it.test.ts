import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HouseholdQueryRunner } from "../src/platform/db/module-db.ts";
import { ApiProblem, problemBody } from "../src/platform/http/problem.ts";
import { defineVersionedTable, updateVersioned } from "../src/platform/http/versioned.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { householdA, householdB } from "./http.ts";

/**
 * Security review of PR #86 (NFR-15 FR 13) on a real PostgreSQL, under row-level security like a module
 * role: many parallel changes — exactly one applies, no lost update; changedFields names only fields of the
 * client's base that the caller may read, and never a value (adapted to the base semantics decided after review); a field left undefined is not overwritten; the same id in another space is
 * neither changed nor revealed; a version outside the column's range is a client error, not a 500.
 */
let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
const pool: pg.Client[] = [];
// Low-entropy throw-away password of a role that exists only in this test database.
const APP_PASSWORD = ["sec86", "app", "role"].join("-");

const ID = "5d2f3c1a-8b7e-4c6d-9a0b-1e2f3a4b5c6d";
const assets = defineVersionedTable({
  table: "sec86_assets",
  fields: { name: "name", note: "note", value: "value_amount" },
  // `note` may be written but is not readable here: it is never compared (no guessed value is confirmed).
  readable: ["name", "value"],
});

/** A household transaction as the module role sees it: bound to one household by a setting RLS reads. */
async function inHousehold<T>(
  client: pg.Client,
  householdId: string,
  work: (q: HouseholdQueryRunner) => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('sec86.household', $1, true)", [householdId]);
    const result = await work({
      householdId,
      query: ((text: string, values?: readonly unknown[]) =>
        client.query(text, values as unknown[])) as HouseholdQueryRunner["query"],
    });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

const settle = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  const role = `sec86_app_${Math.random().toString(36).slice(2, 8)}`;
  await owner.query(`CREATE ROLE ${role} LOGIN PASSWORD '${APP_PASSWORD}'`);
  await owner.query(`
    CREATE TABLE sec86_assets (
      household_id uuid NOT NULL,
      id uuid NOT NULL,
      version integer NOT NULL DEFAULT 1,
      name text NOT NULL,
      note text,
      value_amount numeric(38, 18),
      PRIMARY KEY (household_id, id)
    );
    ALTER TABLE sec86_assets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE sec86_assets FORCE ROW LEVEL SECURITY;
    CREATE POLICY household ON sec86_assets
      USING (household_id = current_setting('sec86.household', true)::uuid)
      WITH CHECK (household_id = current_setting('sec86.household', true)::uuid);`);
  await owner.query(`GRANT SELECT, UPDATE ON sec86_assets TO ${role}`);
  // The same id in both spaces: B's record must never change or show through A's update.
  await owner.query(
    `INSERT INTO sec86_assets (household_id, id, name, note, value_amount) VALUES
       ($1, $3, 'Painting', 'private note A', 100), ($2, $3, 'Other space', 'private note B', 5)`,
    [householdA, householdB, ID],
  );
  for (let i = 0; i < 10; i++) {
    const c = new pg.Client({ connectionString: urlAs(db.url, role, APP_PASSWORD) });
    await c.connect();
    pool.push(c);
  }
});

afterAll(async () => {
  for (const c of pool) await c.end();
  await owner?.end();
  await db?.drop();
});

const row = async (householdId: string) =>
  (
    await owner.query(
      "SELECT name, note, value_amount::text AS value, version FROM sec86_assets WHERE household_id = $1 AND id = $2",
      [householdId, ID],
    )
  ).rows[0];

describe("NFR-15 FR 13 under RLS: no lost update", () => {
  it("10 parallel changes from version 1: exactly one applies; the other 9 are VERSION_CONFLICT; nothing else written", async () => {
    const results = await Promise.all(
      pool.map((c, i) =>
        settle(
          inHousehold(c, householdA, (q) =>
            updateVersioned(q, assets, ID, 1, { name: `Painting ${i}` }, { name: "Painting" }),
          ),
        ),
      ),
    );
    const applied = results.filter((r) => r.ok);
    expect(applied).toHaveLength(1);
    const conflicts = results.filter((r) => !r.ok).map((r) => (r as { error: ApiProblem }).error);
    expect(conflicts).toHaveLength(9);
    for (const p of conflicts) {
      expect(p).toBeInstanceOf(ApiProblem);
      expect(p.code).toBe("VERSION_CONFLICT");
      expect(p.extensions?.currentVersion).toBe(2);
    }
    const winner = results.indexOf(applied[0]!);
    expect(await row(householdA)).toMatchObject({ name: `Painting ${winner}`, version: 2 });
    // The other space's record with the same id is untouched.
    expect(await row(householdB)).toMatchObject({ name: "Other space", note: "private note B", version: 1 });
  });
});

describe("NFR-15 FR 13: what a conflict tells the caller", () => {
  // Adapted after review (coordinator decision): changedFields are the fields of the client's base that the
  // caller may read and whose stored value now differs — not the fields it sends.
  it("changedFields names only readable fields of the base that changed — never a sent-only field, never a value", async () => {
    const before = await row(householdA);
    // Someone else changes the note and the value; the caller, still on version 2, sends only the name.
    await inHousehold(pool[0]!, householdA, (q) =>
      updateVersioned(q, assets, ID, 2, { note: "zq other edit", value: "250" }, {}),
    );
    const outcome = await settle(
      inHousehold(pool[1]!, householdA, (q) =>
        updateVersioned(
          q,
          assets,
          ID,
          2,
          { name: "My name" },
          // What the caller read at version 2; `note` is not readable and is ignored.
          { name: before.name, note: "private note A", value: "100" },
        ),
      ),
    );
    const problem = (outcome as { error: ApiProblem }).error;
    expect(problem.code).toBe("VERSION_CONFLICT");
    expect(problem.extensions).toEqual({ currentVersion: 3, changedFields: ["value"] });
    const wire = JSON.stringify(problemBody(problem.code, { extensions: problem.extensions }));
    for (const secret of ["zq other edit", "250", "Painting", "private note"])
      expect(wire).not.toContain(secret);
  });

  it("a field left undefined in the change is not written (no silent NULL)", async () => {
    const { version } = await inHousehold(pool[2]!, householdA, (q) =>
      updateVersioned(q, assets, ID, 3, { name: "Renamed", note: undefined, value: undefined }, {}),
    );
    expect(version).toBe(4);
    expect(await row(householdA)).toMatchObject({
      name: "Renamed",
      note: "zq other edit",
      value: "250.000000000000000000",
    });
  });

  it("caller in space B with A's record id but B's own row hidden by RLS and filter: 404, A unchanged", async () => {
    await owner.query("DELETE FROM sec86_assets WHERE household_id = $1", [householdB]);
    const outcome = await settle(
      inHousehold(pool[3]!, householdB, (q) => updateVersioned(q, assets, ID, 4, { name: "Hijack" }, {})),
    );
    expect((outcome as { error: ApiProblem }).error.code).toBe("NOT_FOUND");
    expect(await row(householdA)).toMatchObject({ name: "Renamed", version: 4 });
  });

  // Was a defect (review of PR #86): a version above the integer column's range reached PostgreSQL (22003, a
  // 500). Fixed: versions above 2^31-1 are VALIDATION_FAILED.
  it("a version beyond the column's range is VALIDATION_FAILED, not a database error", async () => {
    const outcome = await settle(
      inHousehold(pool[4]!, householdA, (q) => updateVersioned(q, assets, ID, 2 ** 40, { name: "x" }, {})),
    );
    expect((outcome as { error: ApiProblem }).error).toBeInstanceOf(ApiProblem);
    expect((outcome as { error: ApiProblem }).error.code).toBe("VALIDATION_FAILED");
  });

  it("a negative or fractional version is VALIDATION_FAILED before any SQL", async () => {
    for (const v of [-1, 1.5, Number.NaN]) {
      const outcome = await settle(
        inHousehold(pool[5]!, householdA, (q) => updateVersioned(q, assets, ID, v, { name: "x" }, {})),
      );
      expect((outcome as { error: ApiProblem }).error.code, String(v)).toBe("VALIDATION_FAILED");
    }
  });
});
