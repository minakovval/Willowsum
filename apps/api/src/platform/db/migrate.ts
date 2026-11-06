import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type pg from "pg";
import { moduleRoleName, schemaName } from "../modules/rules.ts";

/**
 * Versioned migrations, one folder per module: `src/modules/<module>/adapters/db/migrations/NNNN_<slug>.sql`
 * (ARC-01 FR 3, ARC-03 FR 4). Each module owns one schema; each schema has one role that has privileges
 * only on it. Each module role is the login role of that module's own connection pool (module-db.ts) and
 * is a member of no other role, so module code cannot reach another module's tables by any SQL — not by
 * qualifying the table, not by `SET ROLE`, not by temporary tables. The database enforces the boundary.
 */

export const MIGRATIONS_SCHEMA = "platform_migrations";

const FILE_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface Migration {
  readonly module: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrationSource {
  /** Module names in dependency order (topologicalOrder of module-rules.json). */
  readonly modules: readonly string[];
  /** Folder that contains `<module>/adapters/db/migrations`. */
  readonly modulesDir: string;
}

export function readMigrations(source: MigrationSource): Migration[] {
  const migrations: Migration[] = [];
  for (const module of source.modules) {
    const dir = path.join(source.modulesDir, module, "adapters/db/migrations");
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    files.forEach((file, index) => {
      const match = FILE_RE.exec(file);
      if (!match) throw new Error(`${module}/${file}: migration files are named NNNN_slug.sql`);
      if (Number(match[1]) !== index + 1)
        throw new Error(`${module}/${file}: migration numbers must run 0001, 0002, … without gaps`);
      const sql = readFileSync(path.join(dir, file), "utf8");
      migrations.push({ module, name: file, sql, checksum: createHash("sha256").update(sql).digest("hex") });
    });
  }
  return migrations;
}

export interface MigrateResult {
  readonly applied: readonly string[];
}

/**
 * Creates the module schemas and roles and applies pending migrations. Runs as the migration (owner)
 * role, never as a module role. An applied migration whose file changed is an error: migrations are immutable;
 * change the schema with a new migration (expand → migrate → contract, ARC-03 FR 4).
 */
export async function migrate(client: pg.ClientBase, source: MigrationSource): Promise<MigrateResult> {
  const id = (name: string): string => client.escapeIdentifier(name);
  await client.query(`SELECT pg_advisory_lock(hashtext('willowsum.migrate'))`);
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${id(MIGRATIONS_SCHEMA)}`);
    await client.query(`REVOKE ALL ON SCHEMA ${id(MIGRATIONS_SCHEMA)} FROM PUBLIC`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${id(MIGRATIONS_SCHEMA)}.applied (
         module text NOT NULL, name text NOT NULL, checksum text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (module, name))`,
    );
    // Nothing reaches public: every table lives in a module schema. No temporary tables (they would shadow
    // module tables on a reused connection) and no CONNECT for roles not granted it below.
    const database = (await client.query<{ db: string }>("SELECT current_database() AS db")).rows[0]!.db;
    await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
    await client.query(`REVOKE TEMPORARY, CONNECT ON DATABASE ${id(database)} FROM PUBLIC`);

    for (const module of source.modules) {
      const schema = schemaName(module);
      const role = moduleRoleName(module);
      await ensureRole(client, role, "NOLOGIN NOINHERIT");
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${id(schema)}`);
      await client.query(`REVOKE ALL ON SCHEMA ${id(schema)} FROM PUBLIC`);
      await client.query(`GRANT USAGE ON SCHEMA ${id(schema)} TO ${id(role)}`);
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA ${id(schema)} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${id(role)}`,
      );
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA ${id(schema)} GRANT USAGE, SELECT ON SEQUENCES TO ${id(role)}`,
      );
      await client.query(`GRANT CONNECT ON DATABASE ${id(database)} TO ${id(role)}`);
    }

    const done = await client.query<{ module: string; name: string; checksum: string }>(
      `SELECT module, name, checksum FROM ${id(MIGRATIONS_SCHEMA)}.applied`,
    );
    const appliedChecksums = new Map(done.rows.map((r) => [`${r.module}/${r.name}`, r.checksum]));
    const applied: string[] = [];
    for (const migration of readMigrations(source)) {
      const key = `${migration.module}/${migration.name}`;
      const known = appliedChecksums.get(key);
      if (known !== undefined) {
        if (known !== migration.checksum)
          throw new Error(`${key} was changed after it was applied; add a new migration instead`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL search_path = ${id(schemaName(migration.module))}`);
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO ${id(MIGRATIONS_SCHEMA)}.applied (module, name, checksum) VALUES ($1, $2, $3)`,
          [migration.module, migration.name, migration.checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${key} failed: ${(error as Error).message}`, { cause: error });
      }
      applied.push(key);
    }
    await assertIsolatedRoles(client, source.modules);
    return { applied };
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext('willowsum.migrate'))`);
  }
}

/**
 * The boundary holds only while module roles are plain: no superuser, role-creation, RLS bypass or
 * replication attribute, no membership in any role and no role that is a member of them. Checked on
 * every migration run, so a manual GRANT on any environment stops the next deployment.
 */
export async function assertIsolatedRoles(client: pg.ClientBase, modules: readonly string[]): Promise<void> {
  const roles = modules.map(moduleRoleName);
  const result = await client.query<{ rolname: string; problem: string }>(
    `SELECT r.rolname, 'has a privileged attribute' AS problem
       FROM pg_roles r
      WHERE r.rolname = ANY($1) AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolreplication)
     UNION ALL
     SELECT r.rolname, 'is a member of ' || g.rolname
       FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member JOIN pg_roles g ON g.oid = m.roleid
      WHERE r.rolname = ANY($1)
     UNION ALL
     SELECT g.rolname, 'is granted to ' || r.rolname
       FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member JOIN pg_roles g ON g.oid = m.roleid
      WHERE g.rolname = ANY($1)
      ORDER BY 1, 2`,
    [roles],
  );
  if (result.rows.length > 0) {
    throw new Error(
      `Module roles must stay isolated: ${result.rows.map((r) => `${r.rolname} ${r.problem}`).join("; ")}`,
    );
  }
}

/**
 * Lets a module role log in with the given password. Used by infrastructure and tests; in deployed
 * environments the password comes from the secrets store (CICD-12), never from code.
 */
export async function enableModuleLogin(
  client: pg.ClientBase,
  module: string,
  password: string,
): Promise<void> {
  const role = client.escapeIdentifier(moduleRoleName(module));
  await client.query(`ALTER ROLE ${role} LOGIN PASSWORD ${client.escapeLiteral(password)}`);
}

async function ensureRole(client: pg.ClientBase, role: string, options: string): Promise<void> {
  const exists = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role]);
  if (exists.rowCount === 0) await client.query(`CREATE ROLE ${client.escapeIdentifier(role)} ${options}`);
}
