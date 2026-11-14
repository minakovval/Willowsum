// Security review of PR #168 (ARC-01@PoC module skeletons): a skeleton module gets an empty schema and roles that
// reach nothing outside it, declares no routes, events or flags, and opens no dependency path.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiRoutes } from "../src/api.ts";
import { FLAGS } from "../src/modules/feature-flags/index.ts";
import { modules as registry } from "../src/modules/index.ts";
import { CONTEXT_SCHEMA, GUARD_SCHEMA, TYPES_SCHEMA } from "../src/platform/db/isolation.ts";
import {
  moduleRoleName,
  ownerRoleName,
  schemaName,
  type ModuleRules,
} from "../src/platform/modules/rules.ts";
import { apiDir, migrateRealModules, realModules, realModulesDir } from "./real-modules.ts";
import { createTestDatabase } from "./db.ts";

// This list is hard-coded: a module leaves it in the PR that builds it (a wave-2 row that adds a migration, routes or
// events to one of these modules). Removing that module here is not weakening the test.
const SKELETONS = [
  "transactions",
  "categories",
  "categorization",
  "merchants",
  "duplicate-matching",
  "transfer-matching",
  "bulk-actions",
  "budget",
  "goals",
  "recurring",
  "cashflow",
  "debt-payoff",
  "reports",
  "import-sessions",
  "file-parsers",
  "import-recipes",
  "file-storage",
  "staff-admin",
  "notification-delivery",
];
const rules = JSON.parse(readFileSync(path.join(apiDir, "module-rules.json"), "utf8")) as ModuleRules;
const hasMigrations = (m: string): boolean => {
  const dir = path.join(realModulesDir, m, "adapters/db/migrations");
  return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".sql"));
};

describe("sec168: skeleton modules expose nothing", () => {
  it("no skeleton has a migration, a route, an event or a flag", () => {
    for (const m of SKELETONS) {
      expect(hasMigrations(m), m).toBe(false);
      const def = registry.find((d) => d.name === m)!;
      expect(def, m).toBeDefined();
      expect(def.routes ?? [], m).toEqual([]);
      expect([...def.publishes, ...def.consumes], m).toEqual([]);
      expect(
        apiRoutes.filter((r) => r.module === m),
        m,
      ).toEqual([]);
      expect(
        Object.keys(FLAGS).filter((k) => k.startsWith(`${m}.`)),
        m,
      ).toEqual([]);
    }
  });

  it("module-rules.json: skeletons depend on nothing and nothing depends on them", () => {
    for (const m of SKELETONS) {
      expect(rules.modules[m]?.dependsOn, m).toEqual([]);
      for (const [name, rule] of Object.entries(rules.modules))
        expect(rule.dependsOn.includes(m), `${name} → ${m}`).toBe(false);
    }
  });
});

describe("sec168: skeleton schemas and roles after the real migration", () => {
  let client: pg.Client;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    const db = await createTestDatabase();
    drop = db.drop;
    client = new pg.Client({ connectionString: db.url });
    await client.connect();
    await migrateRealModules(client, db.url);
  });
  afterAll(async () => {
    await client?.end();
    await drop?.();
  });

  it("every skeleton schema is empty and its roles reach only their own schema and the platform context", async () => {
    // platform_guard: USAGE to PUBLIC by design (isolation.ts installGuard); its functions are closed (guard-coverage).
    const allowedShared = [
      CONTEXT_SCHEMA,
      TYPES_SCHEMA,
      GUARD_SCHEMA,
      "public",
      "pg_catalog",
      "information_schema",
    ];
    for (const m of SKELETONS) {
      const schema = schemaName(m);
      const objects = await client.query(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1
         UNION ALL SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1`,
        [schema],
      );
      expect(objects.rows, schema).toEqual([]);
      for (const role of [moduleRoleName(m), ownerRoleName(m)]) {
        const reach = await client.query<{ nspname: string }>(
          `SELECT nspname FROM pg_namespace WHERE has_schema_privilege($1, oid, 'USAGE') ORDER BY 1`,
          [role],
        );
        const extra = reach.rows
          .map((r) => r.nspname)
          .filter((s) => s !== schema && !allowedShared.includes(s));
        expect(extra, role).toEqual([]);
        const tables = await client.query(
          `SELECT n.nspname || '.' || c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
              AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
              AND (has_table_privilege($1, c.oid, 'SELECT') OR has_table_privilege($1, c.oid, 'INSERT')
                   OR has_table_privilege($1, c.oid, 'UPDATE') OR has_table_privilege($1, c.oid, 'DELETE'))`,
          [role],
        );
        expect(tables.rows, role).toEqual([]);
      }
      const owner = await client.query<{ login: boolean }>(
        `SELECT rolcanlogin AS login FROM pg_roles WHERE rolname = $1`,
        [ownerRoleName(m)],
      );
      expect(owner.rows[0]?.login, ownerRoleName(m)).toBe(false);
    }
  });

  it("the skeletons are in the migrated module list, so the guard and the role check cover them", () => {
    for (const m of SKELETONS) expect(realModules, m).toContain(m);
  });
});
