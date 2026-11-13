import type pg from "pg";
import { moduleRoles } from "../modules/rules.ts";

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

/** Read-only role of the readiness probe: it may only read the applied-migrations list (ARC-02 FR 4). */
export const PROBE_ROLE = "ws_probe";

/** Bodies of the two platform functions; the boundary check compares the database's copies with them. */
const CURRENT_HOUSEHOLD_BODY = ` SELECT household_id FROM ${CONTEXT_SCHEMA}.bindings
             WHERE pid = pg_catalog.pg_backend_pid() AND role = session_user `;
const BIND_BODY = `
      DECLARE bound_role name;
      BEGIN
        SELECT usename INTO bound_role FROM pg_catalog.pg_stat_activity
         WHERE pid = p_pid AND datname = pg_catalog.current_database();
        IF bound_role IS NULL OR pg_catalog.left(bound_role, 7) NOT IN ('ws_mod_', 'ws_era_') THEN
          RAISE EXCEPTION 'only module connections are bound to a household' USING ERRCODE = '42501';
        END IF;
        INSERT INTO ${CONTEXT_SCHEMA}.bindings (pid, role, household_id) VALUES (p_pid, bound_role, p_household)
          ON CONFLICT (pid) DO UPDATE SET role = EXCLUDED.role, household_id = EXCLUDED.household_id, bound_at = now();
      END `;
const PLATFORM_FUNCTION_CONFIG = "search_path=pg_catalog, pg_temp";

/**
 * The isolation guard (ARC-03, review of PR #75 round 3). A module's owner role owns its tables, and a table
 * owner can always switch row security off, change the policy or add rules. So db:bootstrap installs, as the
 * superuser, an event trigger that runs after every DDL statement. When the statement was run by a module
 * owner role (`current_user` is `ws_own_<schema>`: migration SQL runs in a wrapper owned by it), the
 * trigger calls `check_module(<schema>)`, a SECURITY DEFINER function of the superuser, which
 * 1. isolates a customer table that has no row security yet (new table or new household_id column): ENABLE
 *    and FORCE row security and the household policy — run as the superuser, so the guard does not re-check
 *    its own steps;
 * 2. refuses the statement when any table of the schema is not exactly isolated (row security enabled and
 *    forced, only the household policy, as defined), has row security or policies without household_id,
 *    or when the schema has a materialized view, a rewrite rule (a view's _RETURN aside) or a view without
 *    security_invoker.
 * The statement fails before the migration's next statement, so no row of another household can be copied.
 */
export const GUARD_SCHEMA = "platform_guard";
export const GUARD_TRIGGER = "ws_module_guard";
/** Second event trigger: refuses column-type rewrites by module owner roles (table_rewrite). */
export const REWRITE_GUARD_TRIGGER = "ws_module_rewrite_guard";
/** Body of the runner function migrate.ts creates for each migration (the guard allows exactly it). */
export const RUNNER_FUNCTION = "ws_run_migration";
export const RUNNER_BODY = " BEGIN EXECUTE sql; END ";
const GUARD_REWRITE_BODY = `
      BEGIN
        -- Reason bit 4: a column is rewritten (ALTER COLUMN … TYPE, with or without USING). The rewrite
        -- evaluates an expression over every row of every household; type changes go through a new column.
        IF pg_catalog.left(current_user, 7) = 'ws_own_' AND (pg_catalog.pg_event_trigger_table_rewrite_reason() & 4) <> 0 THEN
          RAISE EXCEPTION 'ARC-03 guard: changing the type of a column rewrites every row of every household; add a new column instead (expand, migrate, contract)'
            USING ERRCODE = '42501';
        END IF;
      END `;
/**
 * Problems no module may have in its schema, as text rows (read-only; used by check_module and by
 * check:schema). Rules from the guard-coverage review of PR #75:
 * - only trigger functions (not SECURITY DEFINER) may live in a module schema, besides the migration
 *   runner: a function in a CHECK, index, generated column or USING expression runs over every household's
 *   rows during DDL, where row policies do not apply; no operators or casts either;
 * - no table inheritance (a parent without the household policy shows the children's rows); declarative
 *   partitions only, and a partitioned table must be a customer table;
 * - CHECK constraints, index expressions and predicates, stored generated columns and extended-statistics
 *   expressions (ANALYZE computes them over every row) may call only immutable pg_catalog functions and
 *   operators (column defaults are not evaluated over other rows).
 */
const MODULE_PROBLEMS_BODY = `
      WITH ns AS (SELECT n.oid FROM pg_catalog.pg_namespace n WHERE n.nspname = p_schema),
      -- Expression trees: catalog objects are pinned, so pg_depend does not list pg_catalog functions; the
      -- function and operator ids are read from the stored trees instead.
      expr AS (
        SELECT con.conname::text AS obj, con.conbin::text AS tree
          FROM pg_catalog.pg_constraint con
          LEFT JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
          LEFT JOIN pg_catalog.pg_type ty ON ty.oid = con.contypid
         WHERE con.conbin IS NOT NULL AND (c.relnamespace = (SELECT oid FROM ns) OR ty.typnamespace = (SELECT oid FROM ns))
        UNION ALL
        SELECT ic.relname::text, COALESCE(i.indexprs::text, '') || ' ' || COALESCE(i.indpred::text, '')
          FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
         WHERE ic.relnamespace = (SELECT oid FROM ns)
        UNION ALL
        SELECT s.stxname::text, s.stxexprs::text
          FROM pg_catalog.pg_statistic_ext s JOIN pg_catalog.pg_class c ON c.oid = s.stxrelid
         WHERE s.stxexprs IS NOT NULL AND (s.stxnamespace = (SELECT oid FROM ns) OR c.relnamespace = (SELECT oid FROM ns))
        UNION ALL
        SELECT c.relname || '.' || a.attname, ad.adbin::text
          FROM pg_catalog.pg_attrdef ad
          JOIN pg_catalog.pg_class c ON c.oid = ad.adrelid
          JOIN pg_catalog.pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
         WHERE c.relnamespace = (SELECT oid FROM ns) AND a.attgenerated <> ''),
      refs AS (
        SELECT e.obj, m[1] AS kind, m[2]::oid AS id
          FROM expr e, pg_catalog.regexp_matches(e.tree, ':(funcid|opfuncid|opno) (\\d+)', 'g') AS m)
      SELECT DISTINCT problem FROM (
        SELECT pg_catalog.format('%I(%s)', p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid))
                 || ': only trigger functions without SECURITY DEFINER may live in a module schema' AS problem
          FROM pg_catalog.pg_proc p
         WHERE p.pronamespace = (SELECT oid FROM ns)
           AND NOT (p.prokind = 'f' AND p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype AND NOT p.prosecdef)
           AND NOT (p.proname = '${RUNNER_FUNCTION}' AND p.prosecdef AND p.prosrc = '${RUNNER_BODY}'
                    AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'sql text')
        UNION ALL
        SELECT o.oid::pg_catalog.regoperator::text || ': operators are not allowed in a module schema'
          FROM pg_catalog.pg_operator o WHERE o.oprnamespace = (SELECT oid FROM ns)
        UNION ALL
        SELECT 'cast (' || c.castsource::pg_catalog.regtype::text || ' AS ' || c.casttarget::pg_catalog.regtype::text
                 || '): casts are not allowed in a module schema'
          FROM pg_catalog.pg_cast c
          JOIN pg_catalog.pg_type st ON st.oid = c.castsource JOIN pg_catalog.pg_type tt ON tt.oid = c.casttarget
         WHERE st.typnamespace = (SELECT oid FROM ns) OR tt.typnamespace = (SELECT oid FROM ns)
        UNION ALL
        SELECT ch.oid::pg_catalog.regclass::text || ' inherits ' || pa.oid::pg_catalog.regclass::text
                 || ': table inheritance is not allowed (declarative partitions only)'
          FROM pg_catalog.pg_inherits i
          JOIN pg_catalog.pg_class ch ON ch.oid = i.inhrelid JOIN pg_catalog.pg_class pa ON pa.oid = i.inhparent
         WHERE (ch.relnamespace = (SELECT oid FROM ns) OR pa.relnamespace = (SELECT oid FROM ns)) AND pa.relkind <> 'p'
        UNION ALL
        SELECT c.relname || ': a partitioned table must be a customer table (household_id)'
          FROM pg_catalog.pg_class c
         WHERE c.relnamespace = (SELECT oid FROM ns) AND c.relkind = 'p'
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                            WHERE a.attrelid = c.oid AND a.attname = 'household_id' AND NOT a.attisdropped)
        UNION ALL
        SELECT r.obj || ': expressions on module tables may call only immutable pg_catalog functions'
          FROM refs r
         WHERE (r.kind IN ('funcid', 'opfuncid') AND r.id <> 0
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = r.id
                                 AND p.pronamespace = 'pg_catalog'::pg_catalog.regnamespace AND p.provolatile = 'i'))
            OR (r.kind = 'opno'
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_operator o JOIN pg_catalog.pg_proc p ON p.oid = o.oprcode
                                 WHERE o.oid = r.id AND p.pronamespace = 'pg_catalog'::pg_catalog.regnamespace
                                   AND p.provolatile = 'i'))
      ) found `;
const GUARD_DDL_BODY = `
      BEGIN
        IF pg_catalog.left(current_user, 7) = 'ws_own_' THEN
          PERFORM ${GUARD_SCHEMA}.check_module(pg_catalog.substr(current_user, 8));
        END IF;
      END `;
const CHECK_MODULE_BODY = `
      DECLARE
        ns oid;
        t record;
        bad text;
        ctx text;
        expected constant text := '(household_id=(SELECTplatform_context.current_household()))';
      BEGIN
        -- Only the event trigger may call this (it runs as the superuser): not module code at runtime.
        -- Three gates; the last two rest on server state, not on text the caller can write.
        -- 1. Call stack: the two frames right above this one must be guard_ddl's call statement and its own
        --    frame (guard_ddl runs with search_path = pg_catalog, pg_temp, so it prints with its schema; a
        --    module function named guard_ddl prints without). This is a coarse filter only: PostgreSQL prints
        --    statement text unescaped, so a caller can end line 2 itself (e.g. after a quoted column alias)
        --    and forge line 3.
        -- 2. Event-trigger state: pg_event_trigger_ddl_commands() fails outside a DDL command. It does not
        --    prove that guard_ddl is the caller: code run inside some other DDL command (a function called by
        --    CREATE TABLE AS) also has that state.
        -- 3. The connection's login role (session_user, unchanged by SECURITY DEFINER and SET ROLE) can act
        --    as the module's owner role (SET). That is the migration runner (or a superuser): it can run the
        --    module's DDL, and so the guard's checks, anyway. Module, context and probe roles cannot.
        --    Migration code on the runner's connection can still reach this function (e.g. a trigger fired by
        --    CREATE TABLE … AS WITH … INSERT); that is accepted: it only isolates and refuses, never weakens.
        GET DIAGNOSTICS ctx = PG_CONTEXT;
        IF pg_catalog.split_part(ctx, E'\\n', 2) IS DISTINCT FROM 'SQL statement "SELECT ${GUARD_SCHEMA}.check_module(pg_catalog.substr(current_user, 8))"'
           OR pg_catalog.split_part(ctx, E'\\n', 3) !~ '^PL/pgSQL function ${GUARD_SCHEMA}\\.guard_ddl\\(\\) line [0-9]+ at PERFORM$' THEN
          RAISE EXCEPTION 'check_module runs only from the isolation guard' USING ERRCODE = '42501';
        END IF;
        BEGIN
          PERFORM pg_catalog.pg_event_trigger_ddl_commands();
        EXCEPTION WHEN event_trigger_protocol_violated THEN
          RAISE EXCEPTION 'check_module runs only from the isolation guard' USING ERRCODE = '42501';
        END;
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                        WHERE r.rolname = 'ws_own_' || p_schema
                          AND pg_catalog.pg_has_role(session_user, r.oid, 'SET')) THEN
          RAISE EXCEPTION 'check_module runs only from the isolation guard' USING ERRCODE = '42501';
        END IF;
        SELECT n.oid INTO ns FROM pg_catalog.pg_namespace n
         WHERE n.nspname = p_schema
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'ws_own_' || p_schema);
        IF ns IS NULL THEN RETURN; END IF;
        FOR t IN
          SELECT c.relname, a.atttypid = 'uuid'::pg_catalog.regtype AND a.attnotnull AS valid
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = 'household_id' AND NOT a.attisdropped
           WHERE c.relnamespace = ns AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid)
        LOOP
          IF NOT t.valid THEN
            RAISE EXCEPTION '%.%: household_id must be uuid NOT NULL', p_schema, t.relname USING ERRCODE = '42501';
          END IF;
          EXECUTE pg_catalog.format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY', p_schema, t.relname);
          EXECUTE pg_catalog.format(
            'CREATE POLICY household_isolation ON %I.%I AS PERMISSIVE FOR ALL TO PUBLIC '
            'USING (household_id = (SELECT platform_context.current_household())) '
            'WITH CHECK (household_id = (SELECT platform_context.current_household()))', p_schema, t.relname);
        END LOOP;
        SELECT pg_catalog.string_agg(problem, '; ' ORDER BY problem) INTO bad FROM (
          SELECT c.relname || ': household_id must be uuid NOT NULL' AS problem
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = 'household_id' AND NOT a.attisdropped
           WHERE c.relnamespace = ns AND c.relkind IN ('r', 'p')
             AND NOT (a.atttypid = 'uuid'::pg_catalog.regtype AND a.attnotnull)
          UNION ALL
          SELECT c.relname || ': row security must stay enabled and forced'
            FROM pg_catalog.pg_class c
           WHERE c.relnamespace = ns AND c.relkind IN ('r', 'p') AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
             AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'household_id' AND NOT a.attisdropped)
          UNION ALL
          SELECT c.relname || ': row security or policies without household_id'
            FROM pg_catalog.pg_class c
           WHERE c.relnamespace = ns AND c.relkind IN ('r', 'p')
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'household_id' AND NOT a.attisdropped)
             AND (c.relrowsecurity OR c.relforcerowsecurity OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid))
          UNION ALL
          SELECT c.relname || ': only the household_isolation policy, as the platform defines it'
            FROM pg_catalog.pg_class c
           WHERE c.relnamespace = ns AND c.relkind IN ('r', 'p')
             AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'household_id' AND NOT a.attisdropped)
             AND NOT (
               (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid) = 1
               AND EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
                            WHERE p.polrelid = c.oid AND p.polname = 'household_isolation' AND p.polpermissive
                              AND p.polcmd = '*' AND p.polroles = '{0}'
                              AND pg_catalog.regexp_replace(pg_catalog.replace(pg_catalog.pg_get_expr(p.polqual, p.polrelid), ' AS current_household', ''), '\\s', '', 'g') = expected
                              AND pg_catalog.regexp_replace(pg_catalog.replace(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), ' AS current_household', ''), '\\s', '', 'g') = expected))
          UNION ALL
          SELECT c.relname || ': materialized views cannot carry row policies'
            FROM pg_catalog.pg_class c WHERE c.relnamespace = ns AND c.relkind = 'm'
          UNION ALL
          SELECT c.relname || ': a view must be WITH (security_invoker = true)'
            FROM pg_catalog.pg_class c
           WHERE c.relnamespace = ns AND c.relkind = 'v'
             AND NOT COALESCE(pg_catalog.array_to_string(c.reloptions, ',') ~* 'security_invoker=(true|on|1)', false)
          UNION ALL
          SELECT 'rule ' || w.rulename || ' on ' || c.relname || ': rewrite rules run with the owner''s rights'
            FROM pg_catalog.pg_rewrite w JOIN pg_catalog.pg_class c ON c.oid = w.ev_class
           WHERE c.relnamespace = ns AND NOT (w.rulename = '_RETURN' AND c.relkind IN ('v', 'm'))
          UNION ALL
          SELECT m.problem FROM ${GUARD_SCHEMA}.module_problems(p_schema) AS m(problem)
        ) found;
        IF bad IS NOT NULL THEN
          RAISE EXCEPTION 'ARC-03 guard: %', bad USING ERRCODE = '42501';
        END IF;
      END `;

/**
 * Installs the guard (db:bootstrap; superuser only, because only a superuser creates event triggers).
 * Idempotent; restores the platform's definition if it was changed.
 */
export async function installGuard(client: pg.ClientBase): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS ${GUARD_SCHEMA};
    REVOKE ALL ON SCHEMA ${GUARD_SCHEMA} FROM PUBLIC;
    GRANT USAGE ON SCHEMA ${GUARD_SCHEMA} TO PUBLIC;
    CREATE OR REPLACE FUNCTION ${GUARD_SCHEMA}.module_problems(p_schema text) RETURNS SETOF text
      LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
      AS $$${MODULE_PROBLEMS_BODY}$$;
    CREATE OR REPLACE FUNCTION ${GUARD_SCHEMA}.guard_rewrite() RETURNS event_trigger
      LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
      AS $$${GUARD_REWRITE_BODY}$$;
    CREATE OR REPLACE FUNCTION ${GUARD_SCHEMA}.check_module(p_schema text) RETURNS void
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
      AS $$${CHECK_MODULE_BODY}$$;
    CREATE OR REPLACE FUNCTION ${GUARD_SCHEMA}.guard_ddl() RETURNS event_trigger
      LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
      AS $$${GUARD_DDL_BODY}$$;
    REVOKE ALL ON FUNCTION ${GUARD_SCHEMA}.check_module(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ${GUARD_SCHEMA}.check_module(text) TO PUBLIC;
    DROP EVENT TRIGGER IF EXISTS ${GUARD_TRIGGER};
    CREATE EVENT TRIGGER ${GUARD_TRIGGER} ON ddl_command_end EXECUTE FUNCTION ${GUARD_SCHEMA}.guard_ddl();
    DROP EVENT TRIGGER IF EXISTS ${REWRITE_GUARD_TRIGGER};
    CREATE EVENT TRIGGER ${REWRITE_GUARD_TRIGGER} ON table_rewrite EXECUTE FUNCTION ${GUARD_SCHEMA}.guard_rewrite();
  `);
}

/** Problems with the guard itself: missing, disabled, changed or not owned by a superuser. */
export async function guardProblems(client: pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<{ problem: string }>(
    `WITH expected_trigger(name, event, fn) AS (
            VALUES ('${GUARD_TRIGGER}', 'ddl_command_end', '${GUARD_SCHEMA}.guard_ddl()'),
                   ('${REWRITE_GUARD_TRIGGER}', 'table_rewrite', '${GUARD_SCHEMA}.guard_rewrite()')),
          expected_fn(signature, definer, body) AS (
            VALUES ('${GUARD_SCHEMA}.guard_ddl()', false, $2),
                   ('${GUARD_SCHEMA}.guard_rewrite()', false, $3),
                   ('${GUARD_SCHEMA}.check_module(text)', true, $4),
                   ('${GUARD_SCHEMA}.module_problems(text)', false, $5))
     SELECT 'the isolation guard (event trigger ' || x.name || ') is missing' AS problem
       FROM expected_trigger x WHERE NOT EXISTS (SELECT 1 FROM pg_event_trigger e WHERE e.evtname = x.name)
     UNION ALL
     SELECT 'event trigger ' || e.evtname || ' differs from the platform''s isolation guard'
       FROM pg_event_trigger e JOIN expected_trigger x ON x.name = e.evtname
      WHERE NOT (e.evtevent = x.event AND e.evtenabled IN ('O', 'A') AND e.evttags IS NULL
                 AND e.evtfoid = to_regprocedure(x.fn) AND (SELECT rolsuper FROM pg_roles WHERE oid = e.evtowner))
     UNION ALL
     SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
              || ' differs from the platform''s isolation guard'
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = '${GUARD_SCHEMA}'
        AND NOT EXISTS (SELECT 1 FROM expected_fn f
                         WHERE p.oid = to_regprocedure(f.signature) AND p.prosecdef = f.definer AND p.prosrc = f.body
                           AND p.proconfig IS NOT DISTINCT FROM ARRAY[$1]
                           AND (SELECT rolsuper FROM pg_roles WHERE oid = p.proowner))
     UNION ALL
     SELECT 'the isolation guard function ' || f.signature || ' is missing'
       FROM expected_fn f WHERE to_regprocedure(f.signature) IS NULL
     UNION ALL
     SELECT '${GUARD_SCHEMA}: is not owned by a superuser'
       FROM pg_namespace n WHERE n.nspname = '${GUARD_SCHEMA}' AND NOT (SELECT rolsuper FROM pg_roles WHERE oid = n.nspowner)
     UNION ALL
     SELECT '${GUARD_SCHEMA}.' || c.relname || ': only the guard''s functions belong in ${GUARD_SCHEMA}'
       FROM pg_class c WHERE c.relnamespace = to_regnamespace('${GUARD_SCHEMA}')
     UNION ALL
     SELECT '${GUARD_SCHEMA}.' || t.typname || ': only the guard''s functions belong in ${GUARD_SCHEMA}'
       FROM pg_type t WHERE t.typnamespace = to_regnamespace('${GUARD_SCHEMA}')`,
    [PLATFORM_FUNCTION_CONFIG, GUARD_DDL_BODY, GUARD_REWRITE_BODY, CHECK_MODULE_BODY, MODULE_PROBLEMS_BODY],
  );
  return rows.map((r) => r.problem);
}

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
      AS $$${CURRENT_HOUSEHOLD_BODY}$$;

    CREATE OR REPLACE FUNCTION ${CONTEXT_SCHEMA}.bind(p_pid integer, p_household uuid) RETURNS void
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
      AS $$${BIND_BODY}$$;
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

/** Lets `role` (a module role, a module owner role or ws_context) use the shared objects it needs, and nothing else. */
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
 * What would let module code escape row policies or reach outside its schema (reviews of PR #75). Checked on
 * every migration run (assertIsolatedRoles) and by check:schema. Module migrations already run as the
 * module's owner role, which can create nothing outside its schema and is itself under row policies; this
 * check is the second line, for objects a privileged role might create by hand or by mistake:
 * - module roles, ws_probe and ws_context own no objects; an owner role owns objects of its own schema only,
 *   and every object in a module schema belongs to that module's owner role;
 * - explicit privileges of module and owner roles cover only their own schema, database CONNECT and the
 *   allowlist: USAGE on platform_context and platform_types, EXECUTE on platform_context.current_household();
 *   global default privileges for them are refused;
 * - no relation (columns and sequences included) outside their own schema is usable by them;
 * - no SECURITY DEFINER function in any schema but the two platform functions, which must be exactly as
 *   the platform defines them; platform_context and platform_types hold nothing else;
 * - no rewrite rules (a view's _RETURN aside), no event triggers, no extension but plpgsql;
 * - no table at all in schema public, and no household_id column outside the module schemas.
 */
export async function boundaryProblems(client: pg.ClientBase, modules: readonly string[]): Promise<string[]> {
  const { rows } = await client.query<{ problem: string }>(
    `WITH roles AS (
            SELECT oid, rolname,
                   CASE left(rolname, 7) WHEN 'ws_mod_' THEN 'module' WHEN 'ws_own_' THEN 'owner'
                                         WHEN 'ws_era_' THEN 'erasure' ELSE 'platform' END AS kind,
                   CASE WHEN left(rolname, 7) IN ('ws_mod_', 'ws_own_', 'ws_era_') THEN substr(rolname, 8) END AS own
              FROM pg_roles WHERE rolname = ANY($1)),
          db AS (SELECT oid FROM pg_database WHERE datname = current_database()),
          modules AS (SELECT n.oid, n.nspname FROM pg_namespace n
                       WHERE EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'ws_mod_' || n.nspname)),
          user_schemas AS (SELECT oid, nspname FROM pg_namespace
                            WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname !~ '^pg_(toast|temp_)'),
          platform_fn AS (SELECT p.oid FROM pg_proc p WHERE p.pronamespace = '${CONTEXT_SCHEMA}'::regnamespace
                            AND p.proname IN ('current_household', 'bind')),
          guard_fn AS (SELECT p.oid FROM pg_proc p WHERE p.pronamespace = to_regnamespace('${GUARD_SCHEMA}')),
          allowed_fn AS (SELECT '${CONTEXT_SCHEMA}.current_household()'::regprocedure::oid AS oid),
          shdep AS (SELECT d.*, o.type AS otype, o.schema AS oschema, o.identity AS oidentity
                      FROM pg_shdepend d, pg_identify_object(d.classid, d.objid, d.objsubid) o
                     WHERE d.dbid IN (0, (SELECT oid FROM db)))
     SELECT r.rolname || ' owns ' || d.otype || ' ' || d.oidentity AS problem
       FROM shdep d JOIN roles r ON r.oid = d.refobjid
      WHERE d.deptype = 'o'
        AND NOT (r.kind = 'owner' AND (
              (d.oschema IS NOT NULL AND d.oschema = r.own)
              OR (d.classid = 'pg_default_acl'::regclass
                  AND (SELECT a.defaclnamespace FROM pg_default_acl a WHERE a.oid = d.objid)
                      IS NOT DISTINCT FROM (SELECT oid FROM pg_namespace WHERE nspname = r.own))))
     UNION ALL
     SELECT r.rolname || ' has privileges on ' || d.otype || ' ' || d.oidentity
       FROM shdep d JOIN roles r ON r.oid = d.refobjid AND r.kind <> 'platform'
      WHERE d.deptype = 'a'
        AND NOT CASE d.classid
          WHEN 'pg_database'::regclass THEN true
          WHEN 'pg_namespace'::regclass THEN d.oidentity IN (r.own, '${CONTEXT_SCHEMA}', '${TYPES_SCHEMA}')
          WHEN 'pg_proc'::regclass THEN d.objid = (SELECT oid FROM allowed_fn) OR d.oschema IS NOT DISTINCT FROM r.own
          WHEN 'pg_default_acl'::regclass THEN
            (SELECT a.defaclnamespace FROM pg_default_acl a WHERE a.oid = d.objid) IS NOT DISTINCT FROM
            (SELECT oid FROM pg_namespace WHERE nspname = r.own)
          ELSE d.oschema IS NOT DISTINCT FROM r.own AND d.oschema IS NOT NULL END
     UNION ALL
     SELECT r.rolname || ' can use ' || n.nspname || '.' || c.relname || ' outside its schema'
       FROM pg_class c JOIN user_schemas n ON n.oid = c.relnamespace CROSS JOIN roles r
      WHERE r.kind <> 'platform' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND n.nspname IS DISTINCT FROM r.own AND has_schema_privilege(r.oid, n.oid, 'USAGE')
        AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(r.oid, c.oid, 'USAGE, SELECT, UPDATE')
                 ELSE has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                      OR has_any_column_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES') END
     UNION ALL
     SELECT n.nspname || '.' || c.relname || ' is not owned by ws_own_' || n.nspname
       FROM pg_class c JOIN modules n ON n.oid = c.relnamespace
      WHERE c.relowner <> COALESCE((SELECT oid FROM pg_roles WHERE rolname = 'ws_own_' || n.nspname), 0)
     UNION ALL
     SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
              || ' is not owned by ws_own_' || n.nspname
       FROM pg_proc p JOIN modules n ON n.oid = p.pronamespace
      WHERE p.proowner <> COALESCE((SELECT oid FROM pg_roles WHERE rolname = 'ws_own_' || n.nspname), 0)
     UNION ALL
     SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
              || ': SECURITY DEFINER functions are allowed only in the platform'
       FROM pg_proc p JOIN user_schemas n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND p.oid NOT IN (SELECT oid FROM platform_fn) AND p.oid NOT IN (SELECT oid FROM guard_fn)
     UNION ALL
     SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
              || ' differs from the platform''s definition'
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('${CONTEXT_SCHEMA}', '${TYPES_SCHEMA}')
        AND NOT (p.oid IN (SELECT oid FROM platform_fn) AND p.prosecdef AND p.proowner = n.nspowner
                 AND p.proconfig IS NOT DISTINCT FROM ARRAY[$2]
                 AND p.prosrc = CASE p.proname WHEN 'current_household' THEN $3 ELSE $4 END)
     UNION ALL
     SELECT n.nspname || '.' || c.relname || ': only the platform''s objects belong in ' || n.nspname
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('${CONTEXT_SCHEMA}', '${TYPES_SCHEMA}')
        AND NOT (n.nspname = '${CONTEXT_SCHEMA}' AND c.relname IN ('bindings', 'bindings_pkey') AND c.relowner = n.nspowner)
     UNION ALL
     SELECT n.nspname || '.' || t.typname || ': only the platform''s objects belong in ' || n.nspname
       FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname IN ('${CONTEXT_SCHEMA}', '${TYPES_SCHEMA}')
        AND NOT (n.nspname = '${CONTEXT_SCHEMA}' AND t.typname IN ('bindings', '_bindings'))
        AND NOT (n.nspname = '${TYPES_SCHEMA}' AND t.typname IN ('data_region', '_data_region') AND t.typowner = n.nspowner)
     UNION ALL
     SELECT 'rule ' || w.rulename || ' on ' || n.nspname || '.' || c.relname || ': rewrite rules run with the owner''s rights'
       FROM pg_rewrite w JOIN pg_class c ON c.oid = w.ev_class JOIN user_schemas n ON n.oid = c.relnamespace
      WHERE NOT (w.rulename = '_RETURN' AND c.relkind IN ('v', 'm'))
     UNION ALL
     SELECT 'event trigger ' || evtname || ': not allowed' FROM pg_event_trigger
      WHERE evtname NOT IN ('${GUARD_TRIGGER}', '${REWRITE_GUARD_TRIGGER}')
     UNION ALL
     SELECT 'extension ' || extname || ': not allowed' FROM pg_extension WHERE extname <> 'plpgsql'
     UNION ALL
     SELECT 'public.' || c.relname || ': no table may live in schema public'
       FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
     UNION ALL
     SELECT n.nspname || '.' || c.relname || ': ${HOUSEHOLD_COLUMN} outside the module schemas'
       FROM pg_class c JOIN user_schemas n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = '${HOUSEHOLD_COLUMN}' AND NOT a.attisdropped
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND n.oid NOT IN (SELECT oid FROM modules)
        AND n.nspname <> '${CONTEXT_SCHEMA}'
      ORDER BY 1`,
    [
      [...moduleRoles(modules), PROBE_ROLE, CONTEXT_ROLE],
      PLATFORM_FUNCTION_CONFIG,
      CURRENT_HOUSEHOLD_BODY,
      BIND_BODY,
    ],
  );
  return [...rows.map((r) => r.problem), ...(await guardProblems(client))];
}
