import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, urlAs } from "../../../test/db.ts";
import { CONTEXT_ROLE } from "./isolation.ts";
import { assertIsolatedRoles, enableContextLogin, enableModuleLogin, migrate } from "./migrate.ts";
import { HouseholdBinder, ModuleDatabase, ModuleDatabases } from "./module-db.ts";

const modulesDir = fileURLToPath(new URL("../../../test/fixtures/db-modules", import.meta.url));
const password = randomBytes(12).toString("hex");

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;
let alpha: ModuleDatabase;
let beta: ModuleDatabase;
let homes: ModuleDatabase;
const fixtureModules = ["alpha", "beta", "homes"];
const householdA = "6f1c1f2e-9a4b-4d55-8e3a-0b7f2a1c9d01";
const householdB = "0d2e7c4a-3b1f-4a9e-9c6d-5e8f1a2b3c02";

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
  await migrate(owner, { modules: fixtureModules, modulesDir });
  for (const module of fixtureModules) await enableModuleLogin(owner, module, password);
  await enableContextLogin(owner, password);
  // One connection per module pool, so every test reuses the same connection: state must not leak.
  databases = new ModuleDatabases({
    connectionFor: (module) => ({ connectionString: urlAs(db.url, `ws_mod_${module}`, password) }),
    context: { connectionString: urlAs(db.url, CONTEXT_ROLE, password) },
    poolSize: 1,
  });
  alpha = databases.for("alpha");
  beta = databases.for("beta");
  homes = databases.for("homes");
  // Seeded by the superuser owner, which bypasses row policies.
  await owner.query(
    "INSERT INTO homes.records (household_id, label) VALUES ($1, 'a1'), ($1, 'a2'), ($2, 'b1')",
    [householdA, householdB],
  );
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
    // A module login role is not the owner: it cannot switch row security off at runtime.
    expect(
      await sqlState(homes.transaction((q) => q.query("ALTER TABLE records NO FORCE ROW LEVEL SECURITY"))),
    ).toBe("42501");
    expect(
      await sqlState(
        homes.transaction((q) => q.query("ALTER POLICY household_isolation ON records USING (true)")),
      ),
    ).toBe("42501");
    expect(await sqlState(alpha.transaction((q) => q.query("CREATE TABLE public.sneaky (id int)")))).toBe(
      "42501",
    );
    expect(
      await sqlState(alpha.transaction((q) => q.query("SELECT * FROM platform_migrations.applied"))),
    ).toBe("42501");
  });

  it("a pool that is not logged in as the module's role is refused", async () => {
    const wrong = new pg.Pool({ connectionString: urlAs(db.url, "ws_mod_alpha", password), max: 1 });
    const binder = new HouseholdBinder(wrong);
    try {
      await expect(
        new ModuleDatabase(wrong, "beta", binder).transaction((q) => q.query("SELECT 1")),
      ).rejects.toThrow(/must log in as ws_mod_beta/);
    } finally {
      await wrong.end();
    }
  });

  it("migrations stop when a module role is granted another role or a privileged attribute", async () => {
    await assertIsolatedRoles(owner, fixtureModules);
    await owner.query("GRANT ws_mod_beta TO ws_mod_alpha");
    await expect(migrate(owner, { modules: fixtureModules, modulesDir })).rejects.toThrow(
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
    expect((await migrate(owner, { modules: fixtureModules, modulesDir })).applied).toEqual([]);
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

  it("migration SQL runs as the module's owner role, not as the migration role (ARC-03, ADR-0002)", async () => {
    await migrate(owner, { modules: ["whoami"], modulesDir });
    const { rows } = await owner.query("SELECT who, session FROM whoami.seen");
    expect(rows).toEqual([{ who: "ws_own_whoami", session: "postgres" }]);
    const { rows: own } = await owner.query(
      "SELECT relowner::regrole::text AS owner FROM pg_class WHERE oid = 'whoami.seen'::regclass",
    );
    expect(own).toEqual([{ owner: "ws_own_whoami" }]);
    const { rows: attrs } = await owner.query(
      "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcanlogin FROM pg_roles WHERE rolname = 'ws_own_whoami'",
    );
    expect(attrs).toEqual([
      { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcanlogin: false },
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

const labels = async (q: { query: (t: string) => Promise<{ rows: { label: string }[] }> }) =>
  (await q.query("SELECT label FROM records ORDER BY label")).rows.map((r) => r.label);

describe("ARC-03 FR 2: household isolation in the database, for the module role", () => {
  it("criterion «дані іншого простору — 0, навіть якщо фільтр у коді забуто»: no filter, own rows only", async () => {
    expect(await homes.inHousehold(householdA, labels)).toEqual(["a1", "a2"]);
    expect(await homes.inHousehold(householdB, labels)).toEqual(["b1"]);
    expect(
      await homes.inHousehold(
        householdA,
        async (q) =>
          (await q.query("SELECT count(*)::int AS n FROM records WHERE household_id = $1", [householdB]))
            .rows,
      ),
    ).toEqual([{ n: 0 }]);
  });

  it("the code-side filter: the runner carries the household it is bound to", async () => {
    const rows = await homes.inHousehold(
      householdA,
      async (q) =>
        (
          await q.query<{ label: string }>("SELECT label FROM records WHERE household_id = $1 ORDER BY 1", [
            q.householdId,
          ])
        ).rows,
    );
    expect(rows.map((r) => r.label)).toEqual(["a1", "a2"]);
  });

  it("a transaction bound to no household sees no customer rows and writes none", async () => {
    expect(await homes.transaction(labels)).toEqual([]);
    expect(
      await sqlState(
        homes.transaction((q) =>
          q.query("INSERT INTO records (household_id, label) VALUES ($1, 'x')", [householdA]),
        ),
      ),
    ).toBe("42501");
  });

  it("rows of another household cannot be written, moved, changed or deleted", async () => {
    const insertB = (q: { query: (t: string, v: unknown[]) => Promise<unknown> }) =>
      q.query("INSERT INTO records (household_id, label) VALUES ($1, 'x')", [householdB]);
    expect(await sqlState(homes.inHousehold(householdA, insertB))).toBe("42501");
    expect(
      await sqlState(
        homes.inHousehold(householdA, (q) => q.query("UPDATE records SET household_id = $1", [householdB])),
      ),
    ).toBe("42501");
    const changed = await homes.inHousehold(householdA, async (q) => [
      (await q.query("UPDATE records SET label = 'hacked' WHERE household_id = $1", [householdB])).rowCount,
      (await q.query("DELETE FROM records WHERE household_id = $1", [householdB])).rowCount,
    ]);
    expect(changed).toEqual([0, 0]);
    expect(await homes.inHousehold(householdB, labels)).toEqual(["b1"]);
  });

  it.each([
    [
      "a custom setting",
      "SELECT set_config('app.household_id', '0d2e7c4a-3b1f-4a9e-9c6d-5e8f1a2b3c02', false)",
    ],
    [
      "writing the binding",
      "UPDATE platform_context.bindings SET household_id = '0d2e7c4a-3b1f-4a9e-9c6d-5e8f1a2b3c02'",
    ],
    [
      "inserting a binding",
      "INSERT INTO platform_context.bindings (pid, role) VALUES (pg_backend_pid(), session_user)",
    ],
    [
      "calling bind",
      "SELECT platform_context.bind(pg_backend_pid(), '0d2e7c4a-3b1f-4a9e-9c6d-5e8f1a2b3c02')",
    ],
    ["becoming ws_context", "SET ROLE ws_context"],
  ])("module SQL cannot choose another household (%s)", async (_, sql) => {
    const seen = await homes.inHousehold(householdA, async (q) => {
      await q.query("SAVEPOINT s");
      await q.query(sql).catch(() => undefined);
      await q.query("ROLLBACK TO SAVEPOINT s");
      return labels(q);
    });
    expect(seen).toEqual(["a1", "a2"]);
    expect(await sqlState(homes.transaction((q) => q.query(sql)))).toBe(
      sql.startsWith("SELECT set_config") ? undefined : "42501",
    );
  });

  it("ending the transaction inside the work and starting another keeps the platform's household", async () => {
    const seen = await homes.inHousehold(householdA, async (q) => {
      await q.query("COMMIT");
      await q.query("BEGIN");
      // SET LOCAL search_path ended with the transaction; the table is named in full.
      return (await q.query<{ label: string }>("SELECT label FROM homes.records ORDER BY label")).rows.map(
        (r) => r.label,
      );
    });
    expect(seen).toEqual(["a1", "a2"]);
  });

  it("the binding is replaced on every transaction of a reused connection", async () => {
    expect(await homes.inHousehold(householdB, labels)).toEqual(["b1"]);
    expect(await homes.transaction(labels)).toEqual([]);
    expect(await homes.inHousehold(householdA, labels)).toEqual(["a1", "a2"]);
  });

  it("a runner kept beyond its transaction is refused", async () => {
    let kept: { query: (t: string) => Promise<unknown> } | undefined;
    await homes.inHousehold(householdA, async (q) => {
      kept = q;
    });
    await expect(kept!.query("SELECT 1")).rejects.toThrow(/transaction has ended/);
  });

  it("the household id must be a UUID", async () => {
    await expect(homes.inHousehold("1 OR 1=1", labels)).rejects.toThrow(/UUID/);
  });

  it("ws_context binds module connections only and reads no data", async () => {
    const ctx = new pg.Client({ connectionString: urlAs(db.url, CONTEXT_ROLE, password) });
    await ctx.connect();
    try {
      expect(
        await sqlState(ctx.query("SELECT platform_context.bind(pg_backend_pid(), $1)", [householdA])),
      ).toBe("42501");
      expect(await sqlState(ctx.query("SELECT * FROM homes.records"))).toBe("42501");
      expect(await sqlState(ctx.query("SELECT * FROM platform_context.bindings"))).toBe("42501");
    } finally {
      await ctx.end();
    }
  });
});

describe("ARC-03: the platform's SECURITY DEFINER functions are hardened", () => {
  it("search_path is pg_catalog, pg_temp; current_household is STABLE and PARALLEL RESTRICTED", async () => {
    const { rows } = await owner.query(
      `SELECT proname, provolatile, proparallel, proconfig FROM pg_proc
        WHERE pronamespace = 'platform_context'::regnamespace ORDER BY proname`,
    );
    expect(rows).toEqual([
      { proname: "bind", provolatile: "v", proparallel: "u", proconfig: ["search_path=pg_catalog, pg_temp"] },
      {
        proname: "current_household",
        provolatile: "s",
        proparallel: "r",
        proconfig: ["search_path=pg_catalog, pg_temp"],
      },
    ]);
  });
});

describe("ARC-03 FR 1: time is UTC in every transaction", () => {
  it("TimeZone is UTC even after module code changed it in an earlier transaction", async () => {
    await alpha.transaction((q) => q.query("SET TimeZone = 'Europe/Kyiv'"));
    expect(await alpha.transaction(async (q) => (await q.query("SHOW TimeZone")).rows)).toEqual([
      { TimeZone: "UTC" },
    ]);
  });
});

describe("ARC-01 / ADR-0001 hardening: no channel between modules outside their schemas", () => {
  it.each([
    ["lo_create", "SELECT lo_create(0)"],
    ["lo_from_bytea", "SELECT lo_from_bytea(0, 'x')"],
    ["lo_open", "SELECT lo_open(1, 262144)"],
  ])("module roles cannot use large objects (%s)", async (_, sql) => {
    expect(await sqlState(alpha.transaction((q) => q.query(sql)))).toBe("42501");
  });

  it("migrations stop when a module role has its own settings (pg_db_role_setting) or large-object access", async () => {
    await owner.query("ALTER ROLE ws_mod_beta SET search_path = alpha");
    await expect(assertIsolatedRoles(owner, ["beta"])).rejects.toThrow(/ws_mod_beta has role settings/);
    await owner.query("ALTER ROLE ws_mod_beta RESET ALL");
    await owner.query("GRANT EXECUTE ON FUNCTION lo_create(oid) TO ws_mod_beta");
    await expect(assertIsolatedRoles(owner, ["beta"])).rejects.toThrow(
      /ws_mod_beta can execute large-object functions/,
    );
    await owner.query("REVOKE EXECUTE ON FUNCTION lo_create(oid) FROM ws_mod_beta");
    await assertIsolatedRoles(owner, fixtureModules);
  });
});
