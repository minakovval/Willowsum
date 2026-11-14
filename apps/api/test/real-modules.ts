import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { enableContextLogin, enableModuleLogin, migrate } from "../src/platform/db/migrate.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import type { SchemaExemptions } from "../src/platform/db/schema-rules.ts";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { moduleRoleName, topologicalOrder, type ModuleRules } from "../src/platform/modules/rules.ts";
import { createAuditLog } from "../src/modules/audit/index.ts";
import { createHouseholdSpaces, type HouseholdSpaces } from "../src/modules/household/index.ts";
import { localKeyManagement } from "../src/platform/adapters/kms/index.ts";
import { createTestDatabase, urlAs } from "./db.ts";

export const apiDir = fileURLToPath(new URL("..", import.meta.url));
export const realModulesDir = path.join(apiDir, "src/modules");
export const realModules = topologicalOrder(
  JSON.parse(readFileSync(path.join(apiDir, "module-rules.json"), "utf8")) as ModuleRules,
);

/**
 * Migrates the real modules into a test database. ARC-03 FR 4, «старий код + нова схема»: when
 * WS_COMPAT_SCHEMA_FROM names the apps/api folder of a newer version, that version's runner and
 * migrations build the schema, and this (older) code's module tests run against it (CI job `api`).
 */
export async function migrateRealModules(owner: pg.ClientBase, url: string): Promise<void> {
  const newer = process.env["WS_COMPAT_SCHEMA_FROM"];
  if (newer) {
    execFileSync(process.execPath, [path.join(newer, "scripts/migrate.ts")], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "inherit",
    });
    return;
  }
  try {
    await migrate(owner, {
      modules: realModules,
      modulesDir: realModulesDir,
      exemptions: JSON.parse(
        readFileSync(path.join(apiDir, "schema-exemptions.json"), "utf8"),
      ) as SchemaExemptions,
    });
  } catch (error) {
    throw sharedLockTableFull(error) ?? error;
  }
}

/** SQLSTATE of «out of shared memory» (PostgreSQL class 53, insufficient resources). */
const OUT_OF_SHARED_MEMORY = "53200";

/**
 * «out of shared memory» while a test database is prepared is not that test's failure. The lock table is one for the
 * whole PostgreSQL cluster (`max_locks_per_transaction` × `max_connections` slots for all databases together), so a
 * session in any other database that takes thousands of locks in one transaction leaves none for a migration here
 * (#222: a 20 000-row probe in another database failed the ledger migration of `arc11-balance-cache`). Returns the
 * error that says so, or undefined for any other error.
 */
export function sharedLockTableFull(error: unknown): Error | undefined {
  const codeOf = (e: unknown) => (e as { code?: unknown } | null)?.code;
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (codeOf(error) !== OUT_OF_SHARED_MEMORY && codeOf(cause) !== OUT_OF_SHARED_MEMORY) return undefined;
  return new Error(
    "The PostgreSQL cluster's shared lock table is full (53200, «out of shared memory»). The table serves every " +
      "database of the cluster: another session, in any database, holds thousands of locks in one transaction. " +
      "This is not a failure of the test. Find the session (SELECT pid, count(*) FROM pg_locks GROUP BY pid), " +
      "run such work as `pnpm db:test run -- <command>` so that it waits for the integration runs " +
      "(infra/local/README.md, «Limitation»), then run the tests again.",
    { cause: error },
  );
}

/** Login for every real module role and the binding role; one ModuleDatabases over them. */
export async function openRealModules(
  owner: pg.ClientBase,
  url: string,
  poolSize = 2,
  password = randomBytes(12).toString("hex"),
): Promise<ModuleDatabases> {
  for (const module of realModules) await enableModuleLogin(owner, module, password);
  await enableContextLogin(owner, password);
  return new ModuleDatabases({
    connectionFor: (module) => ({ connectionString: urlAs(url, moduleRoleName(module), password) }),
    context: { connectionString: urlAs(url, CONTEXT_ROLE, password) },
    poolSize,
  });
}

export interface RealModulesDatabase {
  /** The superuser owner of the throw-away database (bypasses row policies): for seeding and inspection. */
  readonly owner: Pick<pg.Client, "query">;
  readonly databases: ModuleDatabases;
  readonly url: string;
  /** The binding pool's settings (for the erasure pools of ADR-0013, which share the binding role). */
  readonly context: pg.PoolConfig;
  close(): Promise<void>;
}

/** A throw-away database with every real module migrated, for module integration tests (no driver import there). */
export async function setupRealModules(poolSize = 2): Promise<RealModulesDatabase> {
  const db = await createTestDatabase();
  const owner = new pg.Client({ connectionString: db.url });
  const password = randomBytes(12).toString("hex");
  let databases: ModuleDatabases;
  try {
    await owner.connect();
    await migrateRealModules(owner, db.url);
    databases = await openRealModules(owner, db.url, poolSize, password);
  } catch (error) {
    // The caller gets nothing it could close in `afterAll`: without this the database stays in the cluster (#222).
    await owner.end().catch(() => undefined);
    await db.drop().catch(() => undefined);
    throw error;
  }
  return {
    owner,
    databases,
    url: db.url,
    context: { connectionString: urlAs(db.url, CONTEXT_ROLE, password) },
    close: async () => {
      await databases.end();
      await owner.end();
      await db.drop();
    },
  };
}

/** The household module's spaces over a real-modules database (identity's first space on the first sign-in). */
export function householdSpaces(db: Pick<RealModulesDatabase, "databases">): HouseholdSpaces {
  return createHouseholdSpaces(
    db.databases.for("household"),
    createAuditLog(db.databases.for("audit")),
    localKeyManagement(),
  );
}
