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
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
      AS $$ SELECT household_id FROM ${CONTEXT_SCHEMA}.bindings WHERE pid = pg_backend_pid() AND role = session_user $$;

    CREATE OR REPLACE FUNCTION ${CONTEXT_SCHEMA}.bind(p_pid integer, p_household uuid) RETURNS void
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
      AS $$
      DECLARE bound_role name;
      BEGIN
        SELECT usename INTO bound_role FROM pg_stat_activity WHERE pid = p_pid AND datname = current_database();
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
 * large-object functions is revoked from PUBLIC. assertIsolatedRoles checks that no platform role can run them.
 */
export async function revokeLargeObjects(client: pg.ClientBase): Promise<void> {
  await client.query(`
    DO $$ DECLARE f regprocedure;
    BEGIN
      FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
                WHERE p.pronamespace = 'pg_catalog'::regnamespace AND p.proname ~ '^(lo_|loread$|lowrite$)'
      LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f);
      END LOOP;
    END $$`);
}

/** Server-side large-object functions (used by assertIsolatedRoles). */
export const LARGE_OBJECT_FUNCTIONS_SQL = `SELECT p.oid FROM pg_proc p
  WHERE p.pronamespace = 'pg_catalog'::regnamespace AND p.proname ~ '^(lo_|loread$|lowrite$)'`;
