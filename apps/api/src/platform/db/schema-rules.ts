import type pg from "pg";
import { schemaName } from "../modules/rules.ts";
import {
  CONTEXT_SCHEMA,
  HOUSEHOLD_COLUMN,
  ISOLATION_POLICY,
  GUARD_SCHEMA,
  TYPES_SCHEMA,
  boundaryProblems,
} from "./isolation.ts";

/**
 * Schema check (ARC-03, criterion «Таблиця з даними клієнтів без політики рядків — 0»; FR 1–3). Runs on a
 * database migrated with every module (scripts/check-schema.ts in CI) and reports:
 * - a table in a module schema without `household_id` that is not in the exemption list (and stale
 *   exemptions);
 * - a customer-data table (with `household_id`) whose column is not `uuid NOT NULL`, without row-level
 *   security enabled and forced, without the household policy, or with another permissive policy (which
 *   would widen access);
 * - amounts: float or `money` columns, `numeric` other than NUMERIC(38,18), an amount column without its
 *   currency column; time: `timestamp` without time zone or `timetz` (time is UTC, `timestamptz`);
 * - region: a `data_region` column not of the platform type; the household table without its region and
 *   key reference;
 * - objects that would bypass the policy: views without `security_invoker`, materialized views,
 *   SECURITY DEFINER functions in module schemas; and everything outside the module schemas that
 *   boundaryProblems (isolation.ts) checks on every migration run too;
 * - a unique key or foreign key of a customer table without `household_id`: a duplicate-key or foreign-key
 *   error would reveal that a row exists in another household (and a foreign key could point into it). The
 *   one exception is a unique key on a single uuid column: random identifiers reveal nothing to someone
 *   who does not already hold the id.
 */

/** apps/api/schema-exemptions.json: tables in module schemas that hold no customer data, with the reason. */
export interface SchemaExemptions {
  readonly tables: Readonly<Record<string, string>>;
}

/** The table that will hold households (ACC-08): it must carry the data region and the key reference. */
export const HOUSEHOLD_TABLE = "household.households";

const AMOUNT_RE = /^(?:(.+)_)?amount$/;

export async function schemaProblems(
  client: pg.ClientBase,
  modules: readonly string[],
  /** Without it (test fixtures), tables without household_id are not checked against the exemption list. */
  exemptions?: SchemaExemptions,
): Promise<string[]> {
  const schemas = modules.map(schemaName);
  const problems: string[] = [];

  const tables = await client.query<{
    table: string;
    kind: string;
    rls: boolean;
    forced: boolean;
    reloptions: string[] | null;
  }>(
    `SELECT n.nspname || '.' || c.relname AS table, c.relkind AS kind, c.relrowsecurity AS rls,
            c.relforcerowsecurity AS forced, c.reloptions
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      ORDER BY 1`,
    [schemas],
  );
  const columns = await client.query<{
    table: string;
    column: string;
    type: string;
    not_null: boolean;
    base: string;
  }>(
    `SELECT n.nspname || '.' || c.relname AS table, a.attname AS column,
            format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
            format_type(COALESCE(NULLIF(t.typbasetype, 0), a.atttypid), CASE WHEN t.typbasetype <> 0 THEN t.typtypmod ELSE a.atttypmod END) AS base
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid
      WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY 1, a.attnum`,
    [schemas],
  );
  const policies = await client.query<{
    table: string;
    name: string;
    permissive: boolean;
    cmd: string;
    roles: string[];
    qual: string | null;
    check: string | null;
  }>(
    `SELECT n.nspname || '.' || c.relname AS table, p.polname AS name, p.polpermissive AS permissive,
            p.polcmd::text AS cmd, p.polroles::regrole[]::text[] AS roles,
            pg_get_expr(p.polqual, p.polrelid) AS qual, pg_get_expr(p.polwithcheck, p.polrelid) AS check
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1)`,
    [schemas],
  );
  const definers = await client.query<{ fn: string }>(
    `SELECT p.oid::regprocedure::text AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = ANY($1) AND p.prosecdef ORDER BY 1`,
    [schemas],
  );

  const columnsOf = new Map<string, (typeof columns.rows)[number][]>();
  for (const c of columns.rows) columnsOf.set(c.table, [...(columnsOf.get(c.table) ?? []), c]);
  const known = new Set(tables.rows.map((t) => t.table));

  for (const t of tables.rows) {
    if (t.kind === "v") {
      if (!(t.reloptions ?? []).some((o) => /^security_invoker=(true|on|1)$/i.test(o)))
        problems.push(
          `${t.table}: a view must be WITH (security_invoker = true), or it bypasses row policies`,
        );
      continue;
    }
    if (t.kind === "m" || t.kind === "f") {
      problems.push(`${t.table}: materialized views and foreign tables cannot carry row policies`);
      continue;
    }
    const cols = columnsOf.get(t.table) ?? [];
    const household = cols.find((c) => c.column === HOUSEHOLD_COLUMN);
    if (!household) {
      if (exemptions && !(t.table in exemptions.tables))
        problems.push(
          `${t.table}: no ${HOUSEHOLD_COLUMN} column; customer data needs it, other tables go to schema-exemptions.json with a reason`,
        );
    } else {
      if (exemptions && t.table in exemptions.tables)
        problems.push(`${t.table}: has ${HOUSEHOLD_COLUMN} but is listed in schema-exemptions.json`);
      if (household.type !== "uuid" || !household.not_null)
        problems.push(`${t.table}: ${HOUSEHOLD_COLUMN} must be uuid NOT NULL`);
      if (!t.rls || !t.forced)
        problems.push(`${t.table}: customer-data table without row-level security enabled and forced`);
      const own = policies.rows.filter((p) => p.table === t.table);
      const standard = own.find((p) => p.name === ISOLATION_POLICY);
      if (!standard || !isStandardPolicy(standard))
        problems.push(`${t.table}: customer-data table without the ${ISOLATION_POLICY} policy`);
      for (const p of own) {
        // A restrictive policy could only narrow access, but its expression sees rows of every household
        // before the household policy filters them: only the platform's policy is allowed.
        if (p.name !== ISOLATION_POLICY)
          problems.push(`${t.table}: policy ${p.name}: only the ${ISOLATION_POLICY} policy is allowed`);
      }
    }
    problems.push(...columnProblems(t.table, cols));
  }

  for (const name of Object.keys(exemptions?.tables ?? {})) {
    if (!known.has(name) && schemas.includes(name.split(".")[0]!))
      problems.push(`schema-exemptions.json: ${name} does not exist`);
    if (!(exemptions?.tables[name] ?? "").trim())
      problems.push(`schema-exemptions.json: ${name} needs a reason`);
  }
  if (known.has(HOUSEHOLD_TABLE)) {
    const cols = columnsOf.get(HOUSEHOLD_TABLE) ?? [];
    if (!cols.some((c) => c.column === "data_region" && c.not_null))
      problems.push(
        `${HOUSEHOLD_TABLE}: needs data_region ${TYPES_SCHEMA}.data_region NOT NULL (ARC-03 FR 3)`,
      );
    if (!cols.some((c) => c.column === "encryption_key_ref" && c.base === "text" && c.not_null))
      problems.push(`${HOUSEHOLD_TABLE}: needs encryption_key_ref text NOT NULL (ARC-03 FR 3)`);
  }
  for (const { fn } of definers.rows)
    problems.push(`${fn}: SECURITY DEFINER functions in module schemas would bypass row policies`);

  const keys = await client.query<{ table: string; kind: string; name: string }>(
    `WITH customer AS (
       SELECT c.oid, n.nspname || '.' || c.relname AS table, a.attnum AS household
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = $2 AND NOT a.attisdropped
        WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p'))
     SELECT t.table, 'unique key' AS kind, ic.relname AS name
       FROM pg_index i JOIN customer t ON t.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
      WHERE i.indisunique AND NOT (t.household = ANY ((i.indkey::int2[])[0:i.indnkeyatts - 1]))
        AND NOT (i.indnkeyatts = 1 AND EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = t.oid AND a.attnum = i.indkey[0] AND a.atttypid = 'uuid'::regtype))
     UNION ALL
     SELECT t.table, 'foreign key', k.conname
       FROM pg_constraint k JOIN customer t ON t.oid = k.conrelid
      WHERE k.contype = 'f' AND NOT (t.household = ANY (k.conkey))
      ORDER BY 1, 2, 3`,
    [schemas, HOUSEHOLD_COLUMN],
  );
  for (const k of keys.rows)
    problems.push(
      k.kind === "unique key"
        ? `${k.table}: unique key ${k.name} does not include ${HOUSEHOLD_COLUMN} (it would reveal rows of other households)`
        : `${k.table}: foreign key ${k.name} does not include ${HOUSEHOLD_COLUMN}`,
    );
  // The guard's own rules (functions, operators, casts, inheritance, expressions), when the guard is installed.
  const guard = await client.query<{ installed: boolean }>(
    `SELECT to_regprocedure('${GUARD_SCHEMA}.module_problems(text)') IS NOT NULL AS installed`,
  );
  if (guard.rows[0]?.installed) {
    for (const schema of schemas) {
      const found = await client.query<{ problem: string }>(
        `SELECT m.problem FROM ${GUARD_SCHEMA}.module_problems($1) AS m(problem) ORDER BY 1`,
        [schema],
      );
      problems.push(
        ...found.rows.map((r) => `${schema}.${r.problem.replace(new RegExp(`^${schema}\\.`), "")}`),
      );
    }
  }
  problems.push(...(await boundaryProblems(client, modules)));
  return problems;
}

function isStandardPolicy(p: {
  permissive: boolean;
  cmd: string;
  roles: string[];
  qual: string | null;
  check: string | null;
}): boolean {
  const expected = `(${HOUSEHOLD_COLUMN}=(SELECT${CONTEXT_SCHEMA}.current_household()))`;
  const norm = (s: string | null): string =>
    (s ?? "").replace(/\s+/g, "").replace(/AScurrent_household/g, "");
  return (
    p.permissive &&
    p.cmd === "*" &&
    p.roles.length === 1 &&
    p.roles[0] === "-" &&
    norm(p.qual) === expected &&
    norm(p.check) === expected
  );
}

function columnProblems(
  table: string,
  cols: readonly { column: string; type: string; base: string }[],
): string[] {
  const problems: string[] = [];
  const names = new Set(cols.map((c) => c.column));
  for (const c of cols) {
    const at = `${table}.${c.column}`;
    if (["real", "double precision", "money"].includes(c.base))
      problems.push(`${at}: ${c.base} is not allowed; amounts are NUMERIC(38,18) with a currency code`);
    if (c.base.startsWith("numeric") && c.base !== "numeric(38,18)")
      problems.push(`${at}: numeric columns are NUMERIC(38,18), not ${c.base}`);
    if (c.base.startsWith("timestamp") && c.base.endsWith("without time zone"))
      problems.push(`${at}: time is UTC; use timestamptz, not ${c.base}`);
    if (c.base.startsWith("time") && !c.base.startsWith("timestamp"))
      problems.push(`${at}: ${c.base} is not allowed; use timestamptz (UTC)`);
    const amount = AMOUNT_RE.exec(c.column);
    if (amount) {
      const currency = amount[1] ? `${amount[1]}_currency` : "currency";
      if (!names.has(currency)) problems.push(`${at}: an amount needs its currency column ${currency}`);
    }
    if (c.column === "data_region" && c.type !== `${TYPES_SCHEMA}.data_region`)
      problems.push(`${at}: data_region must be of type ${TYPES_SCHEMA}.data_region`);
  }
  return problems;
}
