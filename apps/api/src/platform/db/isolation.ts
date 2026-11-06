import type pg from "pg";

/**
 * Household isolation in the database (ARC-03 FR 2): every customer-data table has `household_id uuid NOT
 * NULL`, row-level security is enabled and forced on it, and its one permissive policy compares
 * `household_id` with the household that the platform bound to the current connection.
 *
 * Trust boundary. Module code reaches the database only through `ModuleDatabase` (modules may not import
 * the driver, check:modules), logged in as its own role `ws_mod_<schema>`. That role can only *read* the
 * binding (`platform_context.current_household()`); it cannot write it, by any SQL. The binding is written
 * by `ModuleDatabase` over a separate connection as `ws_context`, whose only privilege is
 * `platform_context.bind(pid, household)`, and `bind` takes the role of the bound connection from
 * `pg_stat_activity`, so it can bind module connections only. A forgotten `WHERE household_id = …`, a
 * `set_config(…)`, ending the transaction and starting a new one inside the work callback — none of it lets
 * module SQL choose another household.
 */

export const CONTEXT_SCHEMA = "platform_context";
export const TYPES_SCHEMA = "platform_types";
/** Login role of the platform's binding pool: it may only execute platform_context.bind. */
export const CONTEXT_ROLE = "ws_context";
export const HOUSEHOLD_COLUMN = "household_id";
export const ISOLATION_POLICY = "household_isolation";
/** Data regions a household may have (ARC-03 FR 3); another region is another deployment. */
export const DATA_REGIONS = ["eu"] as const;
export type DataRegion = (typeof DATA_REGIONS)[number];

const CURRENT_HOUSEHOLD = `(SELECT ${CONTEXT_SCHEMA}.current_household())`;

/** Objects shared by every module schema: the binding, its functions, platform types. Idempotent. */
export async function ensurePlatformContext(client: pg.ClientBase): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS ${CONTEXT_SCHEMA};
    REVOKE ALL ON SCHEMA ${CONTEXT_SCHEMA} FROM PUBLIC;
    CREATE UNLOGGED TABLE IF NOT EXISTS ${CONTEXT_SCHEMA}.bindings (
      pid integer PRIMARY KEY,
      role name NOT NULL,
      household_id uuid,
      bound_at timestamptz NOT NULL DEFAULT now());
    REVOKE ALL ON ${CONTEXT_SCHEMA}.bindings FROM PUBLIC;

    CREATE OR REPLACE FUNCTION ${CONTEXT_SCHEMA}.current_household() RETURNS uuid
      LANGUAGE sql STABLE PARALLEL RESTRICTED SECURITY DEFINER SET search_path = pg_catalog, pg_temp
      AS $$ SELECT household_id FROM ${CONTEXT_SCHEMA}.bindings
             WHERE pid = pg_catalog.pg_backend_pid() AND role = session_user $$;

    CREATE OR REPLACE FUNCTION ${CONTEXT_SCHEMA}.bind(p_pid integer, p_household uuid) RETURNS void
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
      AS $$
      DECLARE bound_role name;
      BEGIN
        SELECT usename INTO bound_role FROM pg_catalog.pg_stat_activity
         WHERE pid = p_pid AND datname = pg_catalog.current_database();
        IF bound_role IS NULL OR bound_role NOT LIKE 'ws\\_mod\\_%' THEN
          RAISE EXCEPTION 'only module connections are bound to a household' USING ERRCODE = '42501';
        END IF;
        INSERT INTO ${CONTEXT_SCHEMA}.bindings (pid, role, household_id) VALUES (p_pid, bound_role, p_household)
          ON CONFLICT (pid) DO UPDATE SET role = EXCLUDED.role, household_id = EXCLUDED.household_id, bound_at = now();
      END $$;
    REVOKE ALL ON FUNCTION ${CONTEXT_SCHEMA}.current_household() FROM PUBLIC;
    REVOKE ALL ON FUNCTION ${CONTEXT_SCHEMA}.bind(integer, uuid) FROM PUBLIC;

    CREATE SCHEMA IF NOT EXISTS ${TYPES_SCHEMA};
    REVOKE ALL ON SCHEMA ${TYPES_SCHEMA} FROM PUBLIC;
    DO $$ BEGIN
      CREATE DOMAIN ${TYPES_SCHEMA}.data_region AS text
        CONSTRAINT data_region_known CHECK (VALUE IN (${DATA_REGIONS.map((r) => `'${r}'`).join(", ")}));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
}

/** Lets `role` (a module role or ws_context) use the shared objects it needs, and nothing else. */
export async function grantPlatformContext(client: pg.ClientBase, role: string): Promise<void> {
  const r = client.escapeIdentifier(role);
  await client.query(`GRANT USAGE ON SCHEMA ${CONTEXT_SCHEMA} TO ${r}`);
  if (role === CONTEXT_ROLE) {
    await client.query(`GRANT EXECUTE ON FUNCTION ${CONTEXT_SCHEMA}.bind(integer, uuid) TO ${r}`);
  } else {
    await client.query(`GRANT EXECUTE ON FUNCTION ${CONTEXT_SCHEMA}.current_household() TO ${r}`);
    await client.query(`GRANT USAGE ON SCHEMA ${TYPES_SCHEMA} TO ${r}`);
  }
}

/**
 * Enables and forces row-level security with the household policy on every table of `schema` that has a
 * `household_id` column. Runs inside each migration's transaction, so a customer table is never visible
 * without its policy. A missing policy is created; one that differs is left for the schema check to report.
 */
export async function applyHouseholdIsolation(client: pg.ClientBase, schema: string): Promise<void> {
  const { rows } = await client.query<{ table: string; has_policy: boolean; valid: boolean }>(
    `SELECT c.relname AS table,
            EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = $2) AS has_policy,
            a.atttypid = 'uuid'::regtype AND a.attnotnull AS valid
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = $3 AND NOT a.attisdropped
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
      ORDER BY 1`,
    [schema, ISOLATION_POLICY, HOUSEHOLD_COLUMN],
  );
  for (const { table, has_policy, valid } of rows) {
    if (!valid) throw new Error(`${schema}.${table}: ${HOUSEHOLD_COLUMN} must be uuid NOT NULL`);
    const t = `${client.escapeIdentifier(schema)}.${client.escapeIdentifier(table)}`;
    await client.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
    if (!has_policy) {
      await client.query(
        `CREATE POLICY ${ISOLATION_POLICY} ON ${t} AS PERMISSIVE FOR ALL TO PUBLIC
           USING (${HOUSEHOLD_COLUMN} = ${CURRENT_HOUSEHOLD}) WITH CHECK (${HOUSEHOLD_COLUMN} = ${CURRENT_HOUSEHOLD})`,
      );
    }
  }
}

/**
 * Large objects live outside every schema, so a module could hand data to another module through them
 * (lo_create + GRANT SELECT ON LARGE OBJECT). Nothing in Willowsum uses them: EXECUTE on the server-side
 * large-object functions is revoked from PUBLIC. Those functions belong to the bootstrap superuser, so only a
 * superuser can revoke it: once per database (`pnpm --filter @willowsum/api db:bootstrap`). Every later run
 * finds nothing left to revoke and needs no superuser. If something is left and this role cannot revoke it,
 * the run stops and names the bootstrap step.
 */
export async function revokeLargeObjects(client: pg.ClientBase): Promise<void> {
  const open = async (): Promise<string[]> =>
    (
      await client.query<{ fn: string }>(
        `SELECT f.oid::regprocedure::text AS fn FROM (${LARGE_OBJECT_FUNCTIONS_SQL}) f
          WHERE has_function_privilege('public', f.oid, 'EXECUTE') ORDER BY 1`,
      )
    ).rows.map((r) => r.fn);
  const left = await open();
  if (left.length === 0) return;
  for (const fn of left) {
    // Not the function's owner: PostgreSQL refuses or only warns; the re-check below decides.
    await client.query(`REVOKE EXECUTE ON FUNCTION pg_catalog.${fn} FROM PUBLIC`).catch(() => undefined);
  }
  if ((await open()).length > 0)
    throw new Error(
      "Large-object functions are still executable by PUBLIC. Run the one-time bootstrap of this database as a " +
        "superuser (pnpm --filter @willowsum/api db:bootstrap, ADR-0002), then migrate again.",
    );
}

/** Server-side large-object functions (used by assertIsolatedRoles). */
export const LARGE_OBJECT_FUNCTIONS_SQL = `SELECT p.oid FROM pg_proc p
  WHERE p.pronamespace = 'pg_catalog'::regnamespace AND p.proname ~ '^(lo_|loread$|lowrite$)'`;

/**
 * What would let a module role escape row policies outside its own schema (review of PR #75). Checked on
 * every migration run (assertIsolatedRoles) and by check:schema:
 * - module roles, ws_probe and ws_context own no objects (an owner can switch row security off);
 * - a module role's explicit privileges cover only its own schema, its database CONNECT and the allowlist:
 *   USAGE on platform_context and platform_types, EXECUTE on platform_context.current_household();
 * - no SECURITY DEFINER function anywhere is callable by a module role, except current_household();
 * - no relation outside its own schema (and the system catalogs) is usable by a module role;
 * - no table at all in schema public, and no household_id column outside the module schemas.
 */
export async function boundaryProblems(
  client: pg.ClientBase,
  moduleRoles: readonly string[],
  platformRoles: readonly string[],
): Promise<string[]> {
  const { rows } = await client.query<{ problem: string }>(
    `WITH roles AS (SELECT oid, rolname, 'ws_mod_' <> left(rolname, 7) AS platform,
                           CASE WHEN left(rolname, 7) = 'ws_mod_' THEN substr(rolname, 8) END AS own
                      FROM pg_roles WHERE rolname = ANY($1) OR rolname = ANY($2)),
          db AS (SELECT oid FROM pg_database WHERE datname = current_database()),
          modules AS (SELECT n.oid, n.nspname FROM pg_namespace n
                       WHERE EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'ws_mod_' || n.nspname)),
          allowed_fn AS (SELECT '${CONTEXT_SCHEMA}.current_household()'::regprocedure::oid AS oid)
     SELECT r.rolname || ' owns ' || (SELECT o.type || ' ' || o.identity FROM pg_identify_object(d.classid, d.objid, d.objsubid) o) AS problem
       FROM pg_shdepend d JOIN roles r ON r.oid = d.refobjid
      WHERE d.deptype = 'o' AND d.dbid IN (0, (SELECT oid FROM db))
     UNION ALL
     SELECT r.rolname || ' has privileges on ' || (SELECT o.type || ' ' || o.identity FROM pg_identify_object(d.classid, d.objid, d.objsubid) o)
       FROM pg_shdepend d JOIN roles r ON r.oid = d.refobjid AND NOT r.platform
      WHERE d.deptype = 'a' AND d.dbid IN (0, (SELECT oid FROM db))
        AND NOT CASE d.classid
          WHEN 'pg_database'::regclass THEN true
          WHEN 'pg_namespace'::regclass THEN
            (SELECT nspname FROM pg_namespace WHERE oid = d.objid) IN (r.own, '${CONTEXT_SCHEMA}', '${TYPES_SCHEMA}')
          WHEN 'pg_class'::regclass THEN
            (SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = d.objid) = r.own
          WHEN 'pg_proc'::regclass THEN d.objid = (SELECT oid FROM allowed_fn)
            OR (SELECT n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.oid = d.objid) = r.own
          WHEN 'pg_type'::regclass THEN
            (SELECT n.nspname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.oid = d.objid) = r.own
          WHEN 'pg_default_acl'::regclass THEN
            (SELECT n.nspname FROM pg_default_acl a JOIN pg_namespace n ON n.oid = a.defaclnamespace WHERE a.oid = d.objid) = r.own
          ELSE false END
     UNION ALL
     SELECT r.rolname || ' can execute SECURITY DEFINER function '
              || format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace CROSS JOIN roles r
      WHERE NOT r.platform AND p.prosecdef AND p.oid <> (SELECT oid FROM allowed_fn)
        AND has_schema_privilege(r.oid, n.oid, 'USAGE') AND has_function_privilege(r.oid, p.oid, 'EXECUTE')
     UNION ALL
     SELECT r.rolname || ' can use ' || n.nspname || '.' || c.relname || ' outside its schema'
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN roles r
      WHERE NOT r.platform AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname IS DISTINCT FROM r.own
        AND has_schema_privilege(r.oid, n.oid, 'USAGE')
        AND has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     UNION ALL
     SELECT 'public.' || c.relname || ': no table may live in schema public'
       FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
     UNION ALL
     SELECT n.nspname || '.' || c.relname || ': ${HOUSEHOLD_COLUMN} outside the module schemas'
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = '${HOUSEHOLD_COLUMN}' AND NOT a.attisdropped
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND n.oid NOT IN (SELECT oid FROM modules)
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', '${CONTEXT_SCHEMA}')
      ORDER BY 1`,
    [moduleRoles, platformRoles],
  );
  return rows.map((r) => r.problem);
}
