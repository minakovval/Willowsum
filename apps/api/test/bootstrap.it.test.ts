import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { revokeLargeObjects } from "../src/platform/db/isolation.ts";
import { bootstrapDatabase, migrate } from "../src/platform/db/migrate.ts";
import { schemaProblems } from "../src/platform/db/schema-rules.ts";
import { createTestDatabase, urlAs } from "./db.ts";

/**
 * Review of PR #75, blocking 2: a superuser is needed once per database (db:bootstrap closes the
 * large-object functions in pg_catalog, which only a superuser can change). Every later migration run works
 * as a non-superuser database owner with CREATEROLE; module SQL runs as each module's owner role.
 */

const modulesDir = fileURLToPath(new URL("./fixtures/db-modules", import.meta.url));
const password = randomBytes(12).toString("hex");
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function deployerDatabase(): Promise<{ superuser: pg.Client; deployer: pg.Client }> {
  const db = await createTestDatabase();
  const superuser = new pg.Client({ connectionString: db.url });
  await superuser.connect();
  const role = `ws_it_deployer_${randomBytes(4).toString("hex")}`;
  // A fresh module role, so the deployer creates it (and holds only the ADMIN membership PostgreSQL adds).
  for (const r of ["ws_mod_deployed", "ws_own_deployed"])
    await superuser.query(`DROP ROLE IF EXISTS ${r}`).catch(() => undefined);
  await superuser.query(`CREATE ROLE ${role} LOGIN CREATEROLE PASSWORD '${password}'`);
  await superuser.query(`ALTER DATABASE ${new URL(db.url).pathname.slice(1)} OWNER TO ${role}`);
  const deployer = new pg.Client({ connectionString: urlAs(db.url, role, password) });
  await deployer.connect();
  cleanup.push(async () => {
    await deployer.end();
    await superuser.end();
    await db.drop();
    const admin = new pg.Client({ connectionString: process.env["DATABASE_URL"] });
    await admin.connect();
    for (const r of ["ws_mod_deployed", "ws_own_deployed"])
      await admin.query(`DROP ROLE IF EXISTS ${r}`).catch(() => undefined);
    await admin.query(`DROP ROLE ${role}`);
    await admin.end();
  });
  return { superuser, deployer };
}

describe("ARC-03: migrations run as a non-superuser database owner (CREATEROLE, no BYPASSRLS) after a one-time bootstrap", () => {
  it("without the bootstrap the run stops and names the one-time step", async () => {
    const { deployer } = await deployerDatabase();
    const error = await migrate(deployer, { modules: ["deployed"], modulesDir }).then(
      () => "",
      (e: Error) => e.message,
    );
    expect(error).toMatch(/db:bootstrap/);
    expect(error).not.toContain(password);
  });

  it("without the isolation guard (event trigger) the run stops and names the one-time step", async () => {
    const { superuser, deployer } = await deployerDatabase();
    await revokeLargeObjects(superuser); // half a bootstrap: large objects closed, no guard
    const error = await migrate(deployer, { modules: ["deployed"], modulesDir }).then(
      () => "",
      (e: Error) => e.message,
    );
    expect(error).toMatch(/the isolation guard \(event trigger ws_module_guard\) is missing/);
    expect(error).toMatch(/db:bootstrap/);
  });

  it("after the bootstrap every run works as the non-superuser owner, and isolation holds", async () => {
    const { superuser, deployer } = await deployerDatabase();
    await bootstrapDatabase(superuser);
    await bootstrapDatabase(superuser); // idempotent
    expect((await migrate(deployer, { modules: ["deployed"], modulesDir })).applied).toEqual([
      "deployed/0001_records.sql",
    ]);
    expect((await migrate(deployer, { modules: ["deployed"], modulesDir })).applied).toEqual([]);
    expect(await schemaProblems(deployer, ["deployed"], { tables: {} })).toEqual([]);
    const { rows } = await deployer.query<{ owner: string }>(
      "SELECT relowner::regrole::text AS owner FROM pg_class WHERE oid = 'deployed.records'::regclass",
    );
    expect(rows[0]!.owner).toBe("ws_own_deployed");
  });
});
