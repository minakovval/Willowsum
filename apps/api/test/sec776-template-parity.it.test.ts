import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createTestDatabase } from "./db.ts";
import { migrateRealModules, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * PR #776 security review: a suite's database copied from the run's template (`CREATE DATABASE … TEMPLATE`, then
 * migrated again) carries the same policies, row security, owners, grants, default privileges, event triggers and
 * database rights as a database migrated from nothing. Compared catalogue by catalogue, without names that differ.
 */
const SNAPSHOT_SQL: Record<string, string> = {
  policies: `SELECT schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check
               FROM pg_policies ORDER BY 1, 2, 3`,
  relations: `SELECT n.nspname, c.relname, c.relkind, c.relowner::regrole::text AS owner, c.relrowsecurity,
                     c.relforcerowsecurity, c.relacl::text, c.reloptions::text
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
                 AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
               ORDER BY 1, 2`,
  schemas: `SELECT nspname, nspowner::regrole::text AS owner, nspacl::text FROM pg_namespace
             WHERE nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%' ORDER BY 1`,
  functions: `SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
                     p.proowner::regrole::text AS owner, p.prosecdef, p.proacl::text
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE p.proacl IS NOT NULL OR n.nspname NOT IN ('pg_catalog', 'information_schema')
               ORDER BY 1, 2, 3`,
  defaultAcl: `SELECT defaclrole::regrole::text, defaclnamespace::regnamespace::text, defaclobjtype, defaclacl::text
                 FROM pg_default_acl ORDER BY 1, 2, 3`,
  eventTriggers: `SELECT evtname, evtevent, evtowner::regrole::text, evtfoid::regprocedure::text, evtenabled, evttags::text
                    FROM pg_event_trigger ORDER BY 1`,
  database: `SELECT pg_get_userbyid(datdba) AS owner,
                    datacl::text AS acl
               FROM pg_database WHERE datname = current_database()`,
  roleSettings: `SELECT setrole::regrole::text, setconfig::text FROM pg_db_role_setting
                  WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())`,
  applied: `SELECT module, name, checksum FROM platform_migrations.applied ORDER BY 1, 2`,
};

async function snapshot(client: Pick<pg.Client, "query">): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const [key, sql] of Object.entries(SNAPSHOT_SQL)) out[key] = (await client.query(sql)).rows;
  return out;
}

let copy: RealModulesDatabase;
let fresh: { url: string; drop: () => Promise<void> };
let freshOwner: pg.Client;

beforeAll(async () => {
  copy = await setupRealModules();
  fresh = await createTestDatabase();
  freshOwner = new pg.Client({ connectionString: fresh.url });
  await freshOwner.connect();
  await migrateRealModules(freshOwner, fresh.url);
}, 120_000);

afterAll(async () => {
  await freshOwner?.end();
  await fresh?.drop();
  await copy?.close();
});

describe("PR #776: a suite's copy of the template equals a freshly migrated database", () => {
  it("the run provides a template, so this suite really is a copy", () => {
    expect(inject("realModulesTemplate")).toMatch(/^ws_it_tpl_[0-9a-f]{12}$/);
  });

  it("policies, row security, owners, grants, default privileges, event triggers, CONNECT and migrations match", async () => {
    const a = await snapshot(copy.owner);
    const b = await snapshot(freshOwner);
    for (const key of Object.keys(SNAPSHOT_SQL)) expect({ [key]: a[key] }).toEqual({ [key]: b[key] });
    expect((a["policies"] ?? []).length).toBeGreaterThan(0);
  });

  it("PUBLIC has neither CONNECT nor TEMPORARY on the copy", async () => {
    const { rows } = await copy.owner.query<{ c: boolean; t: boolean }>(
      `SELECT has_database_privilege('public', current_database(), 'CONNECT') AS c,
              has_database_privilege('public', current_database(), 'TEMPORARY') AS t`,
    );
    expect(rows[0]).toEqual({ c: false, t: false });
  });
});
