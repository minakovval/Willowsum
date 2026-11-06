import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { CONTEXT_ROLE, PROBE_ROLE } from "../src/platform/db/isolation.ts";
import {
  enableContextLogin,
  enableModuleLogin,
  enableProbeLogin,
  migrate,
} from "../src/platform/db/migrate.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { apiDir } from "./real-modules.ts";

/**
 * Security review of PR #77 (coverage): each of check_module's three gates has a test that fails when that
 * gate alone is removed. Every case reaches check_module with the other two gates passing, so only the gate
 * under test refuses it (checked by mutation: each gate edited out in turn).
 * - gate 1 (call-stack text): the runner's own connection, inside a DDL command, calls check_module
 *   directly (gates 2 and 3 hold, the frames are wrong);
 * - gate 2 (event-trigger state): the runner's connection acting as ws_own_<schema>, outside DDL, with a
 *   forged call stack (gates 1 and 3 hold);
 * - gate 3 (session_user can SET ws_own_<schema>): runtime roles with TEMP granted, inside an unrelated
 *   CREATE TEMP TABLE … AS, with a forged call stack (gates 1 and 2 hold), also naming another schema.
 */

const password = randomBytes(12).toString("hex");
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

const CREATE =
  "CREATE TABLE things (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, label text NOT NULL);";
const REFUSED = /check_module runs only from the isolation guard/;
/** Line 2 ends exactly after the call (quoted alias), line 3 is a forged guard_ddl frame. */
const FRAME = "PL/pgSQL function platform_guard.guard_ddl() line 4 at PERFORM";
const forged = (also = "") =>
  `EXECUTE E'SELECT platform_guard.check_module(pg_catalog.substr(current_user, 8))"\\n${FRAME}\\n"${also}'`;

/** Two migrated modules ("guarded", "other") and the superuser connection that ran their migrations. */
async function setup(): Promise<{ url: string; su: pg.Client }> {
  const modulesDir = path.join(apiDir, "test/.tmp", `guardgates-${randomBytes(4).toString("hex")}`);
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
  return { url: db.url, su };
}

async function failure(p: Promise<unknown>): Promise<(Error & { code?: string }) | null> {
  return p.then(
    () => null,
    (e: Error & { code?: string }) => e,
  );
}

/** Calls `body` from a function evaluated inside an unrelated DDL command (CREATE TEMP TABLE … AS). */
function insideDdl(body: string, nested = ""): string {
  return `CREATE OR REPLACE FUNCTION pg_temp.inside() RETURNS int LANGUAGE plpgsql AS $f$ BEGIN ${nested} ${body}; RETURN 1; END $f$;
          CREATE TEMP TABLE during_ddl AS SELECT pg_temp.inside() AS x`;
}

describe("security review #77: each check_module gate refuses on its own", () => {
  it("gate 1 (call stack): the runner's connection calling check_module directly inside a DDL command gets 42501", async () => {
    const { su } = await setup();
    for (const nested of ["", "CREATE TEMP TABLE nested_ddl (x int);"]) {
      await su.query("DROP TABLE IF EXISTS pg_temp.during_ddl, pg_temp.nested_ddl");
      const error = await failure(
        su.query(insideDdl("PERFORM platform_guard.check_module('guarded')", nested)),
      );
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(REFUSED);
    }
  });

  it.each([
    [
      // Line 2 is the exact call statement (as the owner role), line 3 is not guard_ddl's frame.
      "line 2 exact, line 3 another function's frame",
      "SET LOCAL ROLE ws_own_guarded; PERFORM platform_guard.check_module(pg_catalog.substr(current_user, 8))",
    ],
    [
      // Line 3 is a forged guard_ddl frame, line 2 is another statement (a literal schema name).
      "line 2 another statement, line 3 a forged guard_ddl frame",
      `EXECUTE E'SELECT platform_guard.check_module(''guarded'')"\\n${FRAME}\\n"'`,
    ],
  ])(
    "gate 1 (call stack), each line on its own: the runner's connection inside a DDL command, %s, gets 42501",
    async (_, body) => {
      const { su } = await setup();
      const error = await failure(su.query(insideDdl(body, "CREATE TEMP TABLE nested_ddl (x int);")));
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(REFUSED);
    },
  );

  it("gate 2 (event-trigger state): the runner's session acting as ws_own_<schema> outside DDL, with a forged stack, gets 42501", async () => {
    const { su } = await setup();
    await su.query("SET ROLE ws_own_guarded");
    for (const also of [
      "",
      ", platform_guard.check_module(''guarded'')",
      ", platform_guard.check_module(''other'')",
    ]) {
      const error = await failure(su.query(`DO $$ BEGIN ${forged(also)}; END $$`));
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(REFUSED);
    }
    await su.query("RESET ROLE");
  });

  it.each([
    ["ws_mod_guarded", "other"],
    ["ws_mod_guarded", "guarded"],
    [CONTEXT_ROLE, "guarded"],
    [CONTEXT_ROLE, "other"],
    [PROBE_ROLE, "guarded"],
    [PROBE_ROLE, "other"],
  ])(
    "gate 3 (login role): %s with TEMP, inside an unrelated CREATE TEMP TABLE … AS, forged stack also naming %s, gets 42501",
    async (role, target) => {
      const { url, su } = await setup();
      await enableModuleLogin(su, "guarded", password);
      await enableContextLogin(su, password);
      await enableProbeLogin(su, password);
      await su.query(
        `DO $$ BEGIN EXECUTE pg_catalog.format('GRANT TEMP ON DATABASE %I TO ws_mod_guarded, ${CONTEXT_ROLE}, ${PROBE_ROLE}', current_database()); END $$`,
      );
      const client = new pg.Client({ connectionString: urlAs(url, role, password) });
      await client.connect();
      cleanup.push(() => client.end());
      for (const [also, nested] of [
        ["", ""],
        ["", "CREATE TEMP TABLE nested_ddl (x int);"],
        [`, platform_guard.check_module(''${target}'')`, "CREATE TEMP TABLE nested_ddl (x int);"],
      ] as const) {
        await client.query("DROP TABLE IF EXISTS pg_temp.during_ddl, pg_temp.nested_ddl");
        const error = await failure(client.query(insideDdl(forged(also), nested)));
        expect(error?.code).toBe("42501");
        expect(error?.message).toMatch(REFUSED);
      }
      // Nothing changed in either module schema.
      const { rows } = await su.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_policy WHERE polrelid IN ('guarded.things'::regclass, 'other.things'::regclass)",
      );
      expect(rows[0]?.n).toBe("2");
    },
  );
});
