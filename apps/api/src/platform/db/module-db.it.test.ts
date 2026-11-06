import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, urlAs } from "../../../test/db.ts";
import { APP_ROLE, migrate } from "./migrate.ts";
import { ModuleDatabase } from "./module-db.ts";

const modulesDir = fileURLToPath(new URL("../../../test/fixtures/db-modules", import.meta.url));
const appPassword = randomBytes(12).toString("hex");

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let appPool: pg.Pool;

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
  await owner.query(`ALTER ROLE ${APP_ROLE} LOGIN PASSWORD '${appPassword}'`);
  await owner.query(`GRANT CONNECT ON DATABASE ${new URL(db.url).pathname.slice(1)} TO ${APP_ROLE}`);
  appPool = new pg.Pool({ connectionString: urlAs(db.url, APP_ROLE, appPassword), max: 2 });
});

afterAll(async () => {
  await appPool?.end();
  await owner?.end();
  await db?.drop();
});

describe("ARC-01 FR 3: each module owns its schema; other modules' tables are closed in the database", () => {
  it("a module reads and writes its own tables; unqualified names resolve to its schema", async () => {
    const alpha = new ModuleDatabase(appPool, "alpha");
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
    const alpha = new ModuleDatabase(appPool, "alpha");
    expect(await sqlState(alpha.transaction((q) => q.query("SELECT * FROM beta.items")))).toBe("42501");
    expect(
      await sqlState(alpha.transaction((q) => q.query("INSERT INTO beta.items (label) VALUES ('x')"))),
    ).toBe("42501");
    const beta = new ModuleDatabase(appPool, "beta");
    expect(await sqlState(beta.transaction((q) => q.query("SELECT * FROM alpha.items")))).toBe("42501");
  });

  it("the application role itself has no table privileges (NOINHERIT)", async () => {
    expect(await sqlState(appPool.query("SELECT * FROM alpha.items"))).toBe("42501");
    expect(await sqlState(appPool.query("SELECT * FROM platform_migrations.applied"))).toBe("42501");
    expect(await sqlState(appPool.query("CREATE TABLE public.sneaky (id int)"))).toBe("42501");
  });

  it("module roles cannot change the schema (DDL belongs to migrations)", async () => {
    const alpha = new ModuleDatabase(appPool, "alpha");
    expect(await sqlState(alpha.transaction((q) => q.query("CREATE TABLE extra (id int)")))).toBe("42501");
    expect(await sqlState(alpha.transaction((q) => q.query("DROP TABLE items")))).toBe("42501");
  });

  it("module code may not switch role or search_path", async () => {
    const alpha = new ModuleDatabase(appPool, "alpha");
    for (const sql of [
      "SET ROLE ws_mod_beta",
      "set local role ws_mod_beta",
      "RESET ROLE",
      "SET search_path = beta",
      "SELECT set_config('role', 'ws_mod_beta', true)",
    ]) {
      expect(await sqlState(alpha.transaction((q) => q.query(sql))), sql).toMatch(/may not change the role/);
    }
  });

  it("a failed transaction leaves nothing behind", async () => {
    const alpha = new ModuleDatabase(appPool, "alpha");
    const before = await alpha.transaction(
      async (q) => (await q.query("SELECT count(*)::int AS n FROM items")).rows[0],
    );
    await sqlState(
      alpha.transaction(async (q) => {
        await q.query("INSERT INTO items (amount, currency) VALUES ('1', 'EUR')");
        throw new Error("boom");
      }),
    );
    const after = await alpha.transaction(
      async (q) => (await q.query("SELECT count(*)::int AS n FROM items")).rows[0],
    );
    expect(after).toEqual(before);
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
