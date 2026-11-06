import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, urlAs } from "../../../test/db.ts";
import { assertIsolatedRoles, enableModuleLogin, migrate } from "./migrate.ts";
import { ModuleDatabase, ModuleDatabases } from "./module-db.ts";

const modulesDir = fileURLToPath(new URL("../../../test/fixtures/db-modules", import.meta.url));
const password = randomBytes(12).toString("hex");

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;
let alpha: ModuleDatabase;
let beta: ModuleDatabase;

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message;
  }
}

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrate(owner, { modules: ["alpha", "beta"], modulesDir });
  for (const module of ["alpha", "beta"]) await enableModuleLogin(owner, module, password);
  // One connection per module pool, so every test reuses the same connection: state must not leak.
  databases = new ModuleDatabases({
    connectionFor: (module) => ({ connectionString: urlAs(db.url, `ws_mod_${module}`, password) }),
    poolSize: 1,
  });
  alpha = databases.for("alpha");
  beta = databases.for("beta");
});

afterAll(async () => {
  await databases?.end();
  await owner?.end();
  await db?.drop();
});

const readBeta = "SELECT label FROM beta.items";

describe("ARC-01 FR 3: each module owns its schema; the database closes other modules' tables", () => {
  it("a module reads and writes its own tables; unqualified names resolve to its schema", async () => {
    const rows = await alpha.transaction(async (q) => {
      await q.query("INSERT INTO items (amount, currency) VALUES ($1, $2)", [
        "-125.000000000000000001",
        "EUR",
      ]);
      return (await q.query<{ amount: string }>("SELECT amount::text FROM alpha.items")).rows;
    });
    expect(rows).toEqual([{ amount: "-125.000000000000000001" }]);
  });

  it("a query to another module's table is refused with permission denied (42501), even schema-qualified", async () => {
    expect(await sqlState(alpha.transaction((q) => q.query(readBeta)))).toBe("42501");
    expect(
      await sqlState(alpha.transaction((q) => q.query("INSERT INTO beta.items (label) VALUES ('x')"))),
    ).toBe("42501");
    expect(await sqlState(beta.transaction((q) => q.query("SELECT * FROM alpha.items")))).toBe("42501");
  });

  it.each([
    ["SET ROLE", "SET ROLE ws_mod_beta"],
    ["SET LOCAL ROLE", "SET LOCAL ROLE ws_mod_beta"],
    ["quoted GUC", `SET "role" = 'ws_mod_beta'`],
    ["comment instead of space", "SET/**/ROLE ws_mod_beta"],
    ["set_config", `SELECT "set_config"('role', 'ws_mod_beta', true)`],
    ["dynamic SQL", `DO $$ BEGIN EXECUTE 'SE' || 'T LOCAL ROLE ws_mod_beta'; END $$`],
    ["SET SESSION AUTHORIZATION", "SET SESSION AUTHORIZATION ws_mod_beta"],
  ])("switching to another module's role is refused by the database (%s)", async (_, sql) => {
    expect(await sqlState(alpha.transaction(async (q) => (await q.query(`${sql}; ${readBeta}`)).rows))).toBe(
      "42501",
    );
    expect(
      await sqlState(
        alpha.transaction(async (q) => {
          await q.query(sql).catch(() => undefined);
          return q.query(readBeta);
        }),
      ),
    ).toMatch(/42501|25P02/);
  });

  it("no temporary tables: they would shadow another module's table on a reused connection", async () => {
    expect(await sqlState(alpha.transaction((q) => q.query("CREATE TEMP TABLE items (label text)")))).toBe(
      "42501",
    );
  });

  it("session settings do not survive into the next transaction on the same connection", async () => {
    await alpha.transaction((q) => q.query("SET search_path = public; SET statement_timeout = 1"));
    const rows = await alpha.transaction(async (q) => (await q.query("SHOW search_path")).rows);
    expect(rows).toEqual([{ search_path: "alpha, pg_temp" }]);
    expect(await alpha.transaction(async (q) => (await q.query("SHOW statement_timeout")).rows)).toEqual([
      { statement_timeout: "0" },
    ]);
  });

  it("module roles cannot change the schema (DDL belongs to migrations)", async () => {
    expect(await sqlState(alpha.transaction((q) => q.query("CREATE TABLE extra (id int)")))).toBe("42501");
    expect(await sqlState(alpha.transaction((q) => q.query("DROP TABLE items")))).toBe("42501");
    expect(await sqlState(alpha.transaction((q) => q.query("CREATE TABLE public.sneaky (id int)")))).toBe(
      "42501",
    );
    expect(
      await sqlState(alpha.transaction((q) => q.query("SELECT * FROM platform_migrations.applied"))),
    ).toBe("42501");
  });

  it("a pool that is not logged in as the module's role is refused", async () => {
    const wrong = new pg.Pool({ connectionString: urlAs(db.url, "ws_mod_alpha", password), max: 1 });
    try {
      await expect(new ModuleDatabase(wrong, "beta").transaction((q) => q.query("SELECT 1"))).rejects.toThrow(
        /must log in as ws_mod_beta/,
      );
    } finally {
      await wrong.end();
    }
  });

  it("migrations stop when a module role is granted another role or a privileged attribute", async () => {
    await assertIsolatedRoles(owner, ["alpha", "beta"]);
    await owner.query("GRANT ws_mod_beta TO ws_mod_alpha");
    await expect(migrate(owner, { modules: ["alpha", "beta"], modulesDir })).rejects.toThrow(
      /ws_mod_alpha is a member of ws_mod_beta; ws_mod_beta is granted to ws_mod_alpha/,
    );
    await owner.query("REVOKE ws_mod_beta FROM ws_mod_alpha");
    await owner.query("ALTER ROLE ws_mod_beta BYPASSRLS");
    await expect(assertIsolatedRoles(owner, ["beta"])).rejects.toThrow(
      /ws_mod_beta has a privileged attribute/,
    );
    await owner.query("ALTER ROLE ws_mod_beta NOBYPASSRLS");
  });

  it("a failed transaction leaves nothing behind", async () => {
    const count = async () =>
      alpha.transaction(async (q) => (await q.query("SELECT count(*)::int AS n FROM items")).rows[0]);
    const before = await count();
    await sqlState(
      alpha.transaction(async (q) => {
        await q.query("INSERT INTO items (amount, currency) VALUES ('1', 'EUR')");
        throw new Error("boom");
      }),
    );
    expect(await count()).toEqual(before);
  });
});

describe("ARC-03 FR 4: versioned, immutable migrations", () => {
  it("applies each migration once", async () => {
    expect((await migrate(owner, { modules: ["alpha", "beta"], modulesDir })).applied).toEqual([]);
  });

  it("refuses a migration file that changed after it was applied", async () => {
    await owner.query("UPDATE platform_migrations.applied SET checksum = 'x' WHERE module = 'alpha'");
    await expect(migrate(owner, { modules: ["alpha"], modulesDir })).rejects.toThrow(
      /changed after it was applied/,
    );
    await owner.query("DELETE FROM platform_migrations.applied WHERE module = 'alpha'");
    await owner.query("DROP TABLE alpha.items");
    expect((await migrate(owner, { modules: ["alpha"], modulesDir })).applied).toEqual([
      "alpha/0001_items.sql",
    ]);
  });

  it("rolls back a failing migration completely and does not record it", async () => {
    await expect(migrate(owner, { modules: ["broken"], modulesDir })).rejects.toThrow(
      /broken\/0001_partial.sql failed/,
    );
    const table = await owner.query("SELECT to_regclass('broken.half_done') AS t");
    expect(table.rows[0].t).toBeNull();
    const recorded = await owner.query("SELECT 1 FROM platform_migrations.applied WHERE module = 'broken'");
    expect(recorded.rowCount).toBe(0);
  });
});
