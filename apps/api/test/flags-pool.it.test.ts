import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { enableContextLogin, enableModuleLogin } from "../src/platform/db/migrate.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { moduleRoleName } from "../src/platform/modules/rules.ts";
import { contextPoolOptions, modulePoolOptions } from "../src/wiring.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { migrateRealModules } from "./real-modules.ts";

/**
 * CICD-06 / ADR-0004 on a real PostgreSQL, with the pool settings main.ts uses (src/wiring.ts): the
 * feature-flags pool ends a hung statement after 5 s, and the setting survives the DISCARD ALL after each
 * transaction; the binding pool (ws_context) has the same limit.
 */
let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;
const password = randomBytes(12).toString("hex");

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  await enableModuleLogin(owner, "feature-flags", password);
  await enableContextLogin(owner, password);
  databases = new ModuleDatabases({
    connectionFor: (module) => ({
      connectionString: urlAs(db.url, moduleRoleName(module), password),
      ...modulePoolOptions(module),
    }),
    context: { connectionString: urlAs(db.url, CONTEXT_ROLE, password), ...contextPoolOptions() },
    poolSize: 1,
  });
});

afterAll(async () => {
  await databases?.end();
  await owner?.end();
  await db?.drop();
});

describe("CICD-06: a hung flag reload ends after 5 s", () => {
  it("a statement longer than 5 s is cancelled (57014), and the next transaction still has the limit", async () => {
    const flags = databases.for("feature-flags");
    const t0 = Date.now();
    const outcome = await flags
      .transaction((q) => q.query("SELECT pg_sleep(6)"))
      .then(
        () => "ok",
        (e: { code?: string }) => e.code,
      );
    expect(outcome).toBe("57014");
    expect(Date.now() - t0).toBeLessThan(5_900);
    const { rows } = await flags.transaction((q) =>
      q.query<{ statement_timeout: string }>("SHOW statement_timeout"),
    );
    expect(rows[0]!.statement_timeout).toBe("5s");
  }, 20_000);

  it("the binding pool (ws_context) gets the 5 s limit too", async () => {
    const pool = new pg.Pool({
      connectionString: urlAs(db.url, CONTEXT_ROLE, password),
      max: 1,
      ...contextPoolOptions(),
    });
    const { rows } = await pool.query<{ statement_timeout: string }>("SHOW statement_timeout");
    expect(rows[0]!.statement_timeout).toBe("5s");
    await pool.end();
  });
});
