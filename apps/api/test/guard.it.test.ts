import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { enableContextLogin, enableModuleLogin, migrate } from "../src/platform/db/migrate.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { apiDir } from "./real-modules.ts";

/**
 * Review of PR #75, round 3: the owner role of a module owns its tables, and a table owner can always
 * switch row security off, change or replace the policy, add rules or materialized views. The guard is an
 * event trigger that db:bootstrap installs (owned by the superuser): after every DDL statement of a module
 * owner role it checks the module's schema and refuses the statement. So migration SQL cannot weaken the
 * isolation even for one statement, and no row of another household can be copied.
 */

const householdA = "6f1c1f2e-9a4b-4d55-8e3a-0b7f2a1c9d01";
const householdB = "0d2e7c4a-3b1f-4a9e-9c6d-5e8f1a2b3c02";
const password = randomBytes(12).toString("hex");
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

const CREATE =
  "CREATE TABLE things (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, label text NOT NULL);";
const COPY = `INSERT INTO things (household_id, label) SELECT '${householdA}', 'copied:' || label FROM things WHERE household_id = '${householdB}';`;

/** A module «guarded» with 0001 (its table) and, after rows of two households exist, 0002 (the probe). */
async function probe(sql: string): Promise<{ error: string; seenByA: string[]; rows: number }> {
  const modulesDir = path.join(apiDir, "test/.tmp", `guard-${randomBytes(4).toString("hex")}`);
  const migrations = path.join(modulesDir, "guarded/adapters/db/migrations");
  mkdirSync(migrations, { recursive: true });
  cleanup.push(async () => rmSync(modulesDir, { recursive: true, force: true }));
  writeFileSync(path.join(migrations, "0001_things.sql"), CREATE);

  const db = await createTestDatabase();
  const owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  cleanup.push(async () => {
    await owner.end();
    await db.drop();
  });
  await migrate(owner, { modules: ["guarded"], modulesDir });
  await owner.query("INSERT INTO guarded.things (household_id, label) VALUES ($1, 'a1'), ($2, 'b1')", [
    householdA,
    householdB,
  ]);

  writeFileSync(path.join(migrations, "0002_probe.sql"), sql);
  const error = await migrate(owner, { modules: ["guarded"], modulesDir }).then(
    () => "",
    (e: Error) => e.message,
  );

  await enableModuleLogin(owner, "guarded", password);
  await enableContextLogin(owner, password);
  const databases = new ModuleDatabases({
    connectionFor: () => ({ connectionString: urlAs(db.url, "ws_mod_guarded", password) }),
    context: { connectionString: urlAs(db.url, CONTEXT_ROLE, password) },
    poolSize: 1,
  });
  cleanup.push(() => databases.end());
  const seenByA = await databases
    .for("guarded")
    .inHousehold(householdA, async (q) =>
      (await q.query<{ label: string }>("SELECT label FROM things ORDER BY label")).rows.map((r) => r.label),
    );
  const rows = (await owner.query<{ n: number }>("SELECT count(*)::int AS n FROM guarded.things")).rows[0]!.n;
  return { error, seenByA, rows };
}

describe("ARC-03 round 3: a module migration cannot weaken row security on its own tables", () => {
  it.each([
    [
      "the reviewer's probe: NO FORCE, copy, materialized view, ALTER POLICY",
      `ALTER TABLE things NO FORCE ROW LEVEL SECURITY;
       ${COPY}
       CREATE MATERIALIZED VIEW snap AS SELECT * FROM things;
       ALTER POLICY household_isolation ON things USING (true);`,
    ],
    ["NO FORCE ROW LEVEL SECURITY", `ALTER TABLE things NO FORCE ROW LEVEL SECURITY; ${COPY}`],
    ["DISABLE ROW LEVEL SECURITY", `ALTER TABLE things DISABLE ROW LEVEL SECURITY; ${COPY}`],
    [
      "DISABLE and NO FORCE in one statement",
      `ALTER TABLE things DISABLE ROW LEVEL SECURITY, NO FORCE ROW LEVEL SECURITY; ${COPY}`,
    ],
    [
      "ALTER POLICY … USING (true)",
      `ALTER POLICY household_isolation ON things USING (true) WITH CHECK (true); ${COPY}`,
    ],
    [
      "DROP POLICY and CREATE POLICY … USING (true)",
      `DROP POLICY household_isolation ON things; CREATE POLICY open ON things USING (true) WITH CHECK (true); ${COPY}`,
    ],
    ["another (restrictive) policy", `CREATE POLICY narrow ON things AS RESTRICTIVE USING (true); ${COPY}`],
    ["CREATE MATERIALIZED VIEW", "CREATE MATERIALIZED VIEW snap AS SELECT * FROM things;"],
    [
      "CREATE RULE",
      "CREATE RULE leak AS ON INSERT TO things DO ALSO SELECT household_id, label FROM things;",
    ],
    ["a view without security_invoker", "CREATE VIEW plain AS SELECT * FROM things;"],
    [
      "ALTER COLUMN … TYPE … USING with a pg_catalog function (the rewrite would see every row)",
      "ALTER TABLE things ALTER COLUMN label TYPE varchar USING (label || pg_catalog.set_config('ws.x', label, false));",
    ],
    ["a column type change that rewrites the table", "ALTER TABLE things ALTER COLUMN label TYPE char(20);"],
    [
      "a type change inside a DO block",
      "DO $$ BEGIN EXECUTE 'ALTER TABLE things ALTER COLUMN label TYPE char(20)'; END $$;",
    ],
    [
      "a function that is not a trigger function",
      "CREATE FUNCTION f(t text) RETURNS boolean LANGUAGE sql AS 'SELECT true';",
    ],
    ["a procedure", "CREATE PROCEDURE p() LANGUAGE sql AS 'SELECT 1';"],
    [
      "an operator (even over a pg_catalog function)",
      "CREATE OPERATOR === (LEFTARG = text, RIGHTARG = text, FUNCTION = pg_catalog.texteq);",
    ],
    [
      "a CHECK with a volatile pg_catalog function",
      "ALTER TABLE things ADD CONSTRAINT r CHECK (label <> pg_catalog.random()::text);",
    ],
    [
      "a domain CHECK with a volatile pg_catalog function",
      "CREATE DOMAIN short_text AS text CHECK (VALUE <> pg_catalog.random()::text);",
    ],
    // PostgreSQL 16 itself accepts volatile functions in statistics expressions (unlike index expressions):
    // CREATE STATISTICS … ON (label || random()::text) succeeds even as a superuser, and ANALYZE then
    // computes the expression over every row. The guard is the only barrier here.
    [
      "extended statistics on an expression with a volatile pg_catalog function (ANALYZE computes it over every row)",
      "CREATE STATISTICS peek ON (label || pg_catalog.random()::text), household_id FROM things;",
    ],
    [
      "extended statistics on an expression with a function outside pg_catalog",
      "CREATE STATISTICS peek ON (platform_context.current_household()), household_id FROM things;",
    ],
    ["traditional inheritance", "CREATE TABLE base (id uuid, label text); ALTER TABLE things INHERIT base;"],
    ["renaming household_id away", `ALTER TABLE things RENAME COLUMN household_id TO owner_id; ${COPY}`],
  ])("%s: the migration fails, no row is copied, household A sees only its own rows", async (_, sql) => {
    const { error, seenByA, rows } = await probe(sql);
    expect(error).toMatch(/^Migration guarded\/0002_probe\.sql failed: ARC-03 guard: /);
    expect(seenByA).toEqual(["a1"]);
    expect(rows).toBe(2);
  });

  it("a new customer table is isolated by the guard at once, inside the migration, before any later statement", async () => {
    const { error, seenByA } = await probe(
      `CREATE TABLE more (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL);
       DO $$ BEGIN
         IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'more'::regclass) THEN
           RAISE EXCEPTION 'not isolated yet';
         END IF;
       END $$;`,
    );
    expect(error).toBe("");
    expect(seenByA).toEqual(["a1"]);
  });

  it("expand steps on a customer table still work (new column, default, index, check, generated column, partitions, trigger, extended statistics)", async () => {
    const { error } = await probe(
      `ALTER TABLE things ADD COLUMN note text;
       ALTER TABLE things ADD COLUMN ref uuid NOT NULL DEFAULT gen_random_uuid();
       CREATE INDEX things_label ON things (label);
       CREATE INDEX things_lower ON things (lower(label)) WHERE label <> '';
       ALTER TABLE things ADD CONSTRAINT label_short CHECK (length(label) < 100);
       ALTER TABLE things ADD COLUMN label_upper text GENERATED ALWAYS AS (upper(label)) STORED;
       CREATE TABLE parts (id uuid NOT NULL, household_id uuid NOT NULL, label text) PARTITION BY HASH (id);
       CREATE TABLE parts_0 PARTITION OF parts FOR VALUES WITH (MODULUS 1, REMAINDER 0);
       CREATE FUNCTION touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
       CREATE TRIGGER touch BEFORE INSERT ON things FOR EACH ROW EXECUTE FUNCTION touch();
       CREATE STATISTICS things_stats ON (lower(label)), household_id FROM things;`,
    );
    expect(error).toBe("");
  });
});
