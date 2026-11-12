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
  await migrate(owner, {
    modules: realModules,
    modulesDir: realModulesDir,
    exemptions: JSON.parse(
      readFileSync(path.join(apiDir, "schema-exemptions.json"), "utf8"),
    ) as SchemaExemptions,
  });
}

/** Login for every real module role and the binding role; one ModuleDatabases over them. */
export async function openRealModules(
  owner: pg.ClientBase,
  url: string,
  poolSize = 2,
): Promise<ModuleDatabases> {
  const password = randomBytes(12).toString("hex");
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
  close(): Promise<void>;
}

/** A throw-away database with every real module migrated, for module integration tests (no driver import there). */
export async function setupRealModules(poolSize = 2): Promise<RealModulesDatabase> {
  const db = await createTestDatabase();
  const owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  const databases = await openRealModules(owner, db.url, poolSize);
  return {
    owner,
    databases,
    url: db.url,
    close: async () => {
      await databases.end();
      await owner.end();
      await db.drop();
    },
  };
}

/** The household module's spaces over a real-modules database (identity's first space on the first sign-in). */
export function householdSpaces(db: Pick<RealModulesDatabase, "databases">): HouseholdSpaces {
  return createHouseholdSpaces(db.databases.for("household"), createAuditLog(db.databases.for("audit")));
}
