import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapDatabase, migrate } from "../src/platform/db/migrate.ts";
import { schemaProblems } from "../src/platform/db/schema-rules.ts";
import { createTestDatabase, urlAs } from "./db.ts";

/**
 * Review of PR #75, blocking 2: a superuser is needed once per database (db:bootstrap closes the
 * large-object functions in pg_catalog, which only a superuser can change). Every later migration run works
 * as a non-superuser schema owner with BYPASSRLS — the kind of role managed PostgreSQL offers.
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
  await superuser.query("DROP ROLE IF EXISTS ws_mod_deployed").catch(() => undefined);
  await superuser.query(`CREATE ROLE ${role} LOGIN BYPASSRLS CREATEROLE PASSWORD '${password}'`);
  await superuser.query(`ALTER DATABASE ${new URL(db.url).pathname.slice(1)} OWNER TO ${role}`);
  const deployer = new pg.Client({ connectionString: urlAs(db.url, role, password) });
  await deployer.connect();
  cleanup.push(async () => {
    await deployer.end();
    await superuser.end();
    await db.drop();
    const admin = new pg.Client({ connectionString: process.env["DATABASE_URL"] });
    await admin.connect();
    await admin.query("DROP ROLE IF EXISTS ws_mod_deployed").catch(() => undefined);
    await admin.query(`DROP ROLE ${role}`);
    await admin.end();
  });
  return { superuser, deployer };
}

describe("ARC-03: migrations run as a non-superuser BYPASSRLS owner after a one-time bootstrap", () => {
  it("without the bootstrap the run stops and names the one-time step", async () => {
    const { deployer } = await deployerDatabase();
    const error = await migrate(deployer, { modules: ["deployed"], modulesDir }).then(
      () => "",
      (e: Error) => e.message,
    );
    expect(error).toMatch(/db:bootstrap/);
    expect(error).not.toContain(password);
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
    expect(rows[0]!.owner).toMatch(/^ws_it_deployer_/);
  });
});
