import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { CONTEXT_ROLE, guardProblems, installGuard } from "../src/platform/db/isolation.ts";
import { enableContextLogin, enableModuleLogin, migrate } from "../src/platform/db/migrate.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { apiDir } from "./real-modules.ts";

/**
 * Coverage review of the isolation guard (ARC-03, PR #75, security review 5801405103; added as the failing
 * spec, then fixed): every DDL form that can change a table's row
 * security, its policies, or create a relation that exposes a table's rows, run as a module migration.
 * Expected per ADR-0002: the statement is refused, or the schema stays isolated; either way household A
 * never sees a row of household B.
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
/** A table without household_id and a function that writes whatever it is given into it. */
const DUMP = `CREATE TABLE dump (label text);
  CREATE FUNCTION grab(t text) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $f$ BEGIN INSERT INTO dump VALUES (t); RETURN true; END $f$;
  CREATE FUNCTION grab_imm(t text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $f$ BEGIN RETURN grab(t); END $f$;`;

interface Outcome {
  error: string;
  seenByA: string[];
  notIsolated: string[];
}

/**
 * A module «guarded» with 0001 (its table) and, after rows of two households exist, 0002 (the probe).
 * `read` is what household A runs afterwards (every relation it names that exists); `notIsolated` lists
 * the tables of the schema with household_id but without ENABLE + FORCE and the one policy.
 */
async function probe(sql: string, read: string[]): Promise<Outcome> {
  const modulesDir = path.join(apiDir, "test/.tmp", `guardcov-${randomBytes(4).toString("hex")}`);
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
  const seenByA: string[] = [];
  for (const query of read) {
    const rows = await databases
      .for("guarded")
      .inHousehold(householdA, async (q) =>
        (await q.query<{ label: string }>(query)).rows.map((r) => String(r.label)),
      )
      .catch((e: Error) => {
        if (/does not exist/.test(e.message)) return [];
        throw e;
      });
    seenByA.push(...rows);
  }
  const notIsolated = (
    await owner.query<{ t: string }>(
      `SELECT c.relname AS t FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'household_id'
        WHERE c.relnamespace = 'guarded'::regnamespace AND c.relkind IN ('r', 'p')
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity
                   AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) = 1)
        ORDER BY 1`,
    )
  ).rows.map((r) => r.t);
  return { error, seenByA, notIsolated };
}

const OWN = "SELECT label FROM things";
const GUARD = /^Migration guarded\/0002_probe\.sql failed: ARC-03 guard: /;

describe("guard coverage: forms that must be refused by the guard", () => {
  it.each([
    [
      "ALTER VIEW … SET (security_invoker = false)",
      "CREATE VIEW v WITH (security_invoker = true) AS SELECT * FROM things; ALTER VIEW v SET (security_invoker = false);",
      ["SELECT label FROM v"],
    ],
    [
      "ALTER VIEW … RESET (security_invoker)",
      "CREATE VIEW v WITH (security_invoker = true) AS SELECT * FROM things; ALTER VIEW v RESET (security_invoker);",
      ["SELECT label FROM v"],
    ],
    [
      "CREATE OR REPLACE VIEW without the option over a security_invoker view",
      "CREATE VIEW v WITH (security_invoker = true) AS SELECT * FROM things; CREATE OR REPLACE VIEW v AS SELECT * FROM things;",
      ["SELECT label FROM v"],
    ],
    ["ALTER POLICY … RENAME", "ALTER POLICY household_isolation ON things RENAME TO hi;", []],
    [
      "ALTER POLICY … TO a role (not PUBLIC)",
      "ALTER POLICY household_isolation ON things TO ws_own_guarded;",
      [],
    ],
    [
      "DDL inside a DO block (NO FORCE, then copy in the same block)",
      `DO $$ BEGIN
         ALTER TABLE things NO FORCE ROW LEVEL SECURITY;
         CREATE TABLE stolen AS SELECT label FROM things;
       END $$;`,
      ["SELECT label FROM stolen"],
    ],
    [
      "DDL in a function called by the migration",
      `CREATE FUNCTION weaken() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
         ALTER POLICY household_isolation ON things USING (true) WITH CHECK (true);
       END $$;
       SELECT weaken();`,
      [],
    ],
  ])("%s: the migration fails and household A sees only its own rows", async (_, sql, read) => {
    const { error, seenByA, notIsolated } = await probe(sql, [OWN, ...read]);
    expect(error).toMatch(GUARD);
    expect(seenByA).toEqual(["a1"]);
    expect(notIsolated).toEqual([]);
  });
});

describe("guard coverage: forms that may run but must leave the schema isolated", () => {
  it.each([
    ["CREATE TABLE AS", "CREATE TABLE copy AS SELECT * FROM things;", ["SELECT label FROM copy"]],
    ["SELECT INTO", "SELECT * INTO copy FROM things;", ["SELECT label FROM copy"]],
    [
      "CREATE TABLE AS without household_id",
      "CREATE TABLE labels AS SELECT label FROM things;",
      ["SELECT label FROM labels"],
    ],
    [
      "CREATE TABLE … LIKE … INCLUDING ALL",
      "CREATE TABLE twin (LIKE things INCLUDING ALL);",
      ["SELECT label FROM twin"],
    ],
    [
      "CREATE TABLE … PARTITION OF",
      `CREATE TABLE parts (id uuid NOT NULL, household_id uuid NOT NULL, label text) PARTITION BY HASH (id);
       CREATE TABLE parts_0 PARTITION OF parts FOR VALUES WITH (MODULUS 1, REMAINDER 0);`,
      ["SELECT label FROM parts", "SELECT label FROM parts_0"],
    ],
    [
      "ALTER TABLE … ATTACH PARTITION (the customer table becomes a partition)",
      `CREATE TABLE parts (id uuid NOT NULL, household_id uuid NOT NULL, label text NOT NULL) PARTITION BY HASH (id);
       ALTER TABLE parts ATTACH PARTITION things FOR VALUES WITH (MODULUS 1, REMAINDER 0);`,
      ["SELECT label FROM parts"],
    ],
    [
      "ALTER TABLE … ATTACH PARTITION to a parent without household_id",
      `CREATE TABLE parts (id uuid NOT NULL, label text NOT NULL) PARTITION BY HASH (id);
       ALTER TABLE parts ATTACH PARTITION things FOR VALUES WITH (MODULUS 1, REMAINDER 0);`,
      ["SELECT label FROM parts"],
    ],
    [
      "CREATE TABLE … INHERITS (the customer table)",
      "CREATE TABLE child (note text) INHERITS (things);",
      ["SELECT label FROM child"],
    ],
    [
      "ALTER TABLE … INHERIT a parent without household_id",
      "CREATE TABLE base (id uuid, label text); ALTER TABLE things INHERIT base;",
      ["SELECT label FROM base"],
    ],
    ["ALTER TABLE … RENAME TO", "ALTER TABLE things RENAME TO stuff;", ["SELECT label FROM stuff"]],
    [
      "ALTER TABLE … SET SCHEMA public",
      "ALTER TABLE things SET SCHEMA public;",
      ["SELECT label FROM public.things"],
    ],
    [
      "ALTER COLUMN household_id TYPE … USING (move every row to household A)",
      `ALTER TABLE things ALTER COLUMN household_id TYPE uuid USING '${householdA}'::uuid;`,
      [],
    ],
    [
      "ALTER COLUMN … TYPE … USING a function that sees every row",
      `${DUMP} ALTER TABLE things ALTER COLUMN label TYPE varchar USING (CASE WHEN grab(label) THEN label END);`,
      ["SELECT label FROM dump"],
    ],
    [
      "ADD CONSTRAINT … CHECK with a function (validation scans every row)",
      `${DUMP} ALTER TABLE things ADD CONSTRAINT peek CHECK (grab(label));`,
      ["SELECT label FROM dump"],
    ],
    [
      "ADD CONSTRAINT … CHECK writing into a catalog comment (no table without household_id needed)",
      `CREATE FUNCTION note(t text) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $f$ BEGIN
         EXECUTE pg_catalog.format('COMMENT ON FUNCTION note(text) IS %L',
           coalesce(obj_description('note(text)'::regprocedure, 'pg_proc'), '') || t || ',');
         RETURN true; END $f$;
       ALTER TABLE things ADD CONSTRAINT peek CHECK (note(label));`,
      [
        "SELECT unnest(string_to_array(obj_description('note(text)'::regprocedure, 'pg_proc'), ',')) AS label",
      ],
    ],
    [
      "CREATE INDEX on an expression (the build scans every row)",
      `${DUMP} CREATE INDEX peek ON things (grab_imm(label));`,
      ["SELECT label FROM dump"],
    ],
    [
      "ADD COLUMN … GENERATED ALWAYS AS … STORED (the rewrite computes every row)",
      `${DUMP} ALTER TABLE things ADD COLUMN peek boolean GENERATED ALWAYS AS (grab_imm(label)) STORED;`,
      ["SELECT label FROM dump"],
    ],
    [
      "DDL in a DO block whose error is swallowed",
      `DO $$ BEGIN
         BEGIN ALTER TABLE things DISABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END;
         CREATE TABLE stolen AS SELECT label FROM things;
       END $$;`,
      ["SELECT label FROM stolen"],
    ],
  ])(
    "%s: household A never sees household B's rows, every customer table stays isolated",
    async (_, sql, read) => {
      const { seenByA, notIsolated } = await probe(sql, [...read]);
      expect(seenByA).not.toContain("b1");
      expect(notIsolated).toEqual([]);
    },
  );
});

describe("guard coverage: privileges of the guard's functions", () => {
  it("check_module (SECURITY DEFINER) runs only from the event trigger; guard_ddl only runs as an event trigger", async () => {
    const db = await createTestDatabase();
    const su = new pg.Client({ connectionString: db.url });
    await su.connect();
    cleanup.push(async () => {
      await su.end();
      await db.drop();
    });
    await installGuard(su);
    const { rows } = await su.query<{ f: string; definer: boolean }>(
      `SELECT p.oid::regprocedure::text AS f, p.prosecdef AS definer
         FROM pg_proc p WHERE p.pronamespace = 'platform_guard'::regnamespace ORDER BY 1`,
    );
    expect(rows).toEqual([
      { f: "platform_guard.check_module(text)", definer: true },
      { f: "platform_guard.guard_ddl()", definer: false },
      { f: "platform_guard.guard_rewrite()", definer: false },
      { f: "platform_guard.module_problems(text)", definer: false },
    ]);
    await expect(su.query("SELECT platform_guard.check_module('x')")).rejects.toThrow(
      /check_module runs only from the isolation guard/,
    );
    await expect(su.query("SELECT platform_guard.guard_ddl()")).rejects.toThrow(
      /trigger functions can only be called as triggers|can only be called as/,
    );
  });

  it("a module's runtime role cannot call check_module (neither for its own nor for another schema)", async () => {
    const modulesDir = path.join(apiDir, "test/.tmp", `guardcov-${randomBytes(4).toString("hex")}`);
    for (const m of ["guarded", "other"]) {
      const dir = path.join(modulesDir, m, "adapters/db/migrations");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "0001_things.sql"), CREATE);
    }
    cleanup.push(async () => rmSync(modulesDir, { recursive: true, force: true }));
    const db = await createTestDatabase();
    const su = new pg.Client({ connectionString: db.url });
    await su.connect();
    cleanup.push(async () => {
      await su.end();
      await db.drop();
    });
    await migrate(su, { modules: ["guarded", "other"], modulesDir });
    await enableModuleLogin(su, "guarded", password);
    const mod = new pg.Client({ connectionString: urlAs(db.url, "ws_mod_guarded", password) });
    await mod.connect();
    cleanup.push(() => mod.end());
    for (const schema of ["guarded", "other"])
      await expect(mod.query("SELECT platform_guard.check_module($1)", [schema])).rejects.toThrow(
        /check_module runs only from the isolation guard/,
      );
    await expect(
      mod.query("DO $$ BEGIN PERFORM platform_guard.check_module('other'); END $$"),
    ).rejects.toThrow(/check_module runs only from the isolation guard/);
  });

  // Lead's code check of PR #75: a module trigger function named guard_ddl prints without its schema at
  // runtime (the module schema is on the search_path), and the statement text of a dynamic query can carry
  // a forged call-stack line. Neither may pass check_module's gate.
  it.each([
    [
      "a module trigger function named guard_ddl",
      `CREATE FUNCTION guard_ddl() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
         PERFORM platform_guard.check_module(pg_catalog.substr(current_user, 8)); RETURN NEW; END $f$;`,
      "guard_ddl",
    ],
    [
      "a forged guard_ddl() line in the statement text",
      `CREATE FUNCTION forge() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
         EXECUTE E'SELECT platform_guard.check_module(''other'') /*\\nPL/pgSQL function platform_guard.guard_ddl() line 4 at PERFORM\\n*/';
         RETURN NEW; END $f$;`,
      "forge",
    ],
  ])("%s: a module's runtime role that reaches check_module through it gets 42501", async (_, fn, name) => {
    const modulesDir = path.join(apiDir, "test/.tmp", `guardcov-${randomBytes(4).toString("hex")}`);
    for (const m of ["guarded", "other"]) {
      const dir = path.join(modulesDir, m, "adapters/db/migrations");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "0001_things.sql"), CREATE);
    }
    writeFileSync(
      path.join(modulesDir, "guarded/adapters/db/migrations/0002_trigger.sql"),
      `${fn}
       CREATE TRIGGER call_guard BEFORE INSERT ON things FOR EACH ROW EXECUTE FUNCTION ${name}();`,
    );
    cleanup.push(async () => rmSync(modulesDir, { recursive: true, force: true }));
    const db = await createTestDatabase();
    const su = new pg.Client({ connectionString: db.url });
    await su.connect();
    cleanup.push(async () => {
      await su.end();
      await db.drop();
    });
    await migrate(su, { modules: ["guarded", "other"], modulesDir });
    await enableModuleLogin(su, "guarded", password);
    await enableContextLogin(su, password);
    const databases = new ModuleDatabases({
      connectionFor: () => ({ connectionString: urlAs(db.url, "ws_mod_guarded", password) }),
      context: { connectionString: urlAs(db.url, CONTEXT_ROLE, password) },
      poolSize: 1,
    });
    cleanup.push(() => databases.end());
    const error = await databases
      .for("guarded")
      .inHousehold(householdA, (q) =>
        q.query("INSERT INTO things (household_id, label) VALUES ($1, 'x')", [householdA]),
      )
      .then(
        () => null,
        (e: Error & { code?: string }) => e,
      );
    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(/check_module runs only from the isolation guard/);
  });
});

describe("guard coverage: guardProblems detects a weakened guard", () => {
  it.each([
    [
      "ENABLE REPLICA (does not fire in normal sessions)",
      "ALTER EVENT TRIGGER ws_module_guard ENABLE REPLICA",
    ],
    [
      "a replaced guard_ddl()",
      `CREATE OR REPLACE FUNCTION platform_guard.guard_ddl() RETURNS event_trigger LANGUAGE plpgsql
         SET search_path = pg_catalog, pg_temp AS $$ BEGIN END $$`,
    ],
    [
      "the trigger recreated with a tag filter",
      `DROP EVENT TRIGGER ws_module_guard;
       CREATE EVENT TRIGGER ws_module_guard ON ddl_command_end WHEN TAG IN ('CREATE TABLE')
         EXECUTE FUNCTION platform_guard.guard_ddl()`,
    ],
    [
      "the trigger recreated on another event",
      `DROP EVENT TRIGGER ws_module_guard;
       CREATE EVENT TRIGGER ws_module_guard ON ddl_command_start EXECUTE FUNCTION platform_guard.guard_ddl()`,
    ],
    [
      "check_module made SECURITY INVOKER",
      "ALTER FUNCTION platform_guard.check_module(text) SECURITY INVOKER",
    ],
  ])("%s is reported", async (_, sql) => {
    const db = await createTestDatabase();
    const su = new pg.Client({ connectionString: db.url });
    await su.connect();
    cleanup.push(async () => {
      await su.end();
      await db.drop();
    });
    await installGuard(su);
    expect(await guardProblems(su)).toEqual([]);
    await su.query(sql);
    expect((await guardProblems(su)).length).toBeGreaterThan(0);
  });
});
