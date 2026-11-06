import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import {
  assertIsolatedRoles,
  enableContextLogin,
  enableModuleLogin,
  migrate,
} from "../src/platform/db/migrate.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { schemaProblems } from "../src/platform/db/schema-rules.ts";
import { createTestDatabase, urlAs } from "./db.ts";

/**
 * Reviews of PR #75: ways a module migration (or a privileged role by hand) could make module SQL escape
 * row policies. Root fix: a module's migration SQL runs as its owner role ws_own_<schema> inside a SECURITY
 * DEFINER runner (no way back to the deployer), with CREATE only on its own schema and no BYPASSRLS.
 * Defence in depth: boundaryProblems on every migration run and in check:schema.
 */

const fixtures = fileURLToPath(new URL("./fixtures/db-bypass", import.meta.url));
const modulesDir = fileURLToPath(new URL("./fixtures/db-modules", import.meta.url));
const password = randomBytes(12).toString("hex");
const householdA = "6f1c1f2e-9a4b-4d55-8e3a-0b7f2a1c9d01";
const householdB = "0d2e7c4a-3b1f-4a9e-9c6d-5e8f1a2b3c02";
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function database(): Promise<{ url: string; owner: pg.Client }> {
  const db = await createTestDatabase();
  const owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  cleanup.push(async () => {
    await owner.end();
    await db.drop();
  });
  return { url: db.url, owner };
}

const errorOf = (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => "",
    (e: Error) => e.message,
  );

describe("root fix: a module migration cannot create anything with more than its owner role's rights", () => {
  it.each([
    ["a SECURITY DEFINER function in public", "probe-definer", /permission denied for schema public/],
    ["a view in public", "probe-view", /permission denied for schema public/],
    ["a customer table in public", "probe-public", /permission denied for schema public/],
    ["handing its table to the module role", "probe-owner", /must be able to SET ROLE "ws_mod_probe_owner"/],
    ["a schema of its own outside the module", "probe-schema", /permission denied for database/],
    [
      "replacing platform_context.current_household()",
      "probe-replace",
      /permission denied for schema platform_context/,
    ],
    [
      "RESET ROLE back to the migration role",
      "probe-escape",
      /cannot set parameter "role" within security-definer function/,
    ],
    [
      "SET SESSION AUTHORIZATION in dynamic SQL",
      "probe-escape2",
      /cannot set parameter "session_authorization" within security-definer function/,
    ],
  ])("%s: the migration fails and leaves nothing behind", async (_, module, reason) => {
    const { owner } = await database();
    const error = await errorOf(migrate(owner, { modules: [module], modulesDir: fixtures }));
    expect(error).toMatch(new RegExp(`^Migration ${module}/0001_bypass.sql failed: `));
    expect(error).toMatch(reason);
    const applied = await owner.query("SELECT 1 FROM platform_migrations.applied WHERE module = $1", [
      module,
    ]);
    expect(applied.rowCount).toBe(0);
    expect(await schemaProblems(owner, [module], { tables: {} })).toEqual([]);
  });

  it.each([
    [
      "a rewrite rule on its own table",
      "probe-rule",
      /rule leak on probe_rule\.things: rewrite rules run with the owner's rights/,
      "INSERT INTO things (household_id, label) VALUES ($1, 'a2') RETURNING label",
    ],
    [
      "a SECURITY DEFINER trigger function in its own schema",
      "probe-trigger",
      /probe_trigger\.copy_all\(\): SECURITY DEFINER functions are allowed only in the platform/,
      "INSERT INTO things (household_id, label) VALUES ($1, 'pull')",
    ],
  ])(
    "%s: the run stops, and even so the object reads no other household",
    async (_, module, problem, insert) => {
      const { url, owner } = await database();
      const error = await errorOf(migrate(owner, { modules: [module], modulesDir: fixtures }));
      expect(error).toMatch(/^Module roles must stay isolated: /);
      expect(error).toMatch(problem);
      expect((await schemaProblems(owner, [module], { tables: {} })).join("\n")).toMatch(problem);

      // The object belongs to the owner role, which is under the household policy: no leak.
      const table = `${module.replace("-", "_")}.things`;
      await owner.query(`INSERT INTO ${table} (household_id, label) VALUES ($1, 'a1'), ($2, 'b1')`, [
        householdA,
        householdB,
      ]);
      await enableModuleLogin(owner, module, password);
      await enableContextLogin(owner, password);
      const databases = new ModuleDatabases({
        connectionFor: (m) => ({ connectionString: urlAs(url, `ws_mod_${m.replace("-", "_")}`, password) }),
        context: { connectionString: urlAs(url, CONTEXT_ROLE, password) },
        poolSize: 1,
      });
      cleanup.push(() => databases.end());
      const seen = await databases.for(module).inHousehold(householdA, async (q) => {
        const returned = (await q.query<{ label: string }>(insert, [householdA])).rows.map((r) => r.label);
        const visible = (
          await q.query<{ label: string }>("SELECT label FROM things ORDER BY label")
        ).rows.map((r) => r.label);
        return [...returned, ...visible].join(",");
      });
      expect(seen).not.toMatch(/b1/);
    },
  );
});

describe("defence in depth: objects a privileged role creates by hand stop the next run and fail check:schema", () => {
  it.each([
    [
      "a view in public",
      "CREATE VIEW public.v AS SELECT * FROM homes.records; GRANT SELECT ON public.v TO ws_mod_homes",
      [
        /public\.v: no table may live in schema public/,
        /ws_mod_homes has privileges on view public\.v/,
        /ws_mod_homes can use public\.v outside its schema/,
      ],
    ],
    [
      "a customer table without row security in public",
      "CREATE TABLE public.notes (household_id uuid NOT NULL)",
      [/public\.notes: household_id outside the module schemas/],
    ],
    [
      "a SECURITY DEFINER trigger function elsewhere that the module role cannot execute",
      `CREATE SCHEMA ops; CREATE FUNCTION ops.copy_all() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END $$;
       REVOKE ALL ON FUNCTION ops.copy_all() FROM PUBLIC;
       CREATE TRIGGER copy_all AFTER INSERT ON homes.records FOR EACH ROW EXECUTE FUNCTION ops.copy_all()`,
      [/ops\.copy_all\(\): SECURITY DEFINER functions are allowed only in the platform/],
    ],
    [
      "a rule on a module table",
      "CREATE RULE leak AS ON INSERT TO homes.records DO ALSO SELECT 1",
      [/rule leak on homes\.records/],
    ],
    [
      "a replaced current_household() (same OID)",
      `CREATE OR REPLACE FUNCTION platform_context.current_household() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
         SET search_path = pg_catalog, pg_temp AS $$ SELECT nullif(current_setting('ws.h', true), '')::uuid $$`,
      [/platform_context\.current_household\(\) differs from the platform's definition/],
    ],
    [
      "another object in platform_context",
      "CREATE TABLE platform_context.extra (id int)",
      [/platform_context\.extra: only the platform's objects belong in platform_context/],
    ],
    [
      "another type in platform_types",
      "CREATE DOMAIN platform_types.secret AS text",
      [/platform_types\.secret: only the platform's objects belong in platform_types/],
    ],
    [
      "an event trigger",
      "CREATE FUNCTION public.evt() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN END $$; CREATE EVENT TRIGGER evt ON ddl_command_end EXECUTE FUNCTION public.evt()",
      [/event trigger evt: not allowed/],
    ],
    ["an extension", "CREATE EXTENSION citext SCHEMA platform_types", [/extension citext: not allowed/]],
    [
      "column and sequence grants to PUBLIC in another schema",
      `CREATE SCHEMA dropbox; GRANT USAGE ON SCHEMA dropbox TO PUBLIC; CREATE TABLE dropbox.box (data text);
       GRANT SELECT (data), INSERT (data) ON dropbox.box TO PUBLIC; CREATE SEQUENCE dropbox.counter;
       GRANT USAGE ON SEQUENCE dropbox.counter TO PUBLIC`,
      [
        /ws_mod_homes can use dropbox\.box outside its schema/,
        /ws_mod_homes can use dropbox\.counter outside its schema/,
      ],
    ],
    [
      "global default privileges for a module role",
      "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO ws_mod_homes",
      [/ws_mod_homes has privileges on default acl/],
    ],
    [
      "an object in a module schema not owned by its owner role",
      "CREATE TABLE homes.extra (household_id uuid NOT NULL)",
      [/homes\.extra is not owned by ws_own_homes/],
    ],
  ])("%s", async (_, sql, expected) => {
    const { owner } = await database();
    await migrate(owner, { modules: ["homes"], modulesDir });
    await owner.query("BEGIN");
    try {
      await owner.query(sql);
      const run = await errorOf(assertIsolatedRoles(owner, ["homes"]));
      const problems = (await schemaProblems(owner, ["homes"], { tables: {} })).join("\n");
      for (const pattern of expected) {
        expect(run).toMatch(pattern);
        expect(problems).toMatch(pattern);
      }
    } finally {
      await owner.query("ROLLBACK");
    }
    await assertIsolatedRoles(owner, ["homes"]);
  });
});
