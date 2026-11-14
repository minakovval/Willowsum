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
 *   who does not already hold the id;
 * - free text in the ledger (ARC-11 criterion «Тексти, описи або назви мерчантів у таблицях журналу» = 0): see
 *   `LEDGER_CODE_COLUMNS`.
 */

/**
 * ARC-11: the ledger holds no descriptions, merchant names, notes or other text — an entry points to its source
 * (module and id), and texts live there. Deny by default: in the `ledger` schema a column is allowed only if its type,
 * with every domain resolved to its base, is a known non-text type (uuid, numbers, dates, interval, boolean) or an
 * enum; any other column (text, varchar, char, citext, name, json, jsonb, xml, bytea, tsvector, arrays, composite or
 * range types…) must be listed here, with what it holds, and carry a CHECK of its own that limits it to a code (a
 * pattern `~`, a list of values, or a jsonpath `like_regex` for JSON) which PostgreSQL itself refuses free-text
 * probes with. A new text column needs a change here, which the security review sees.
 */
export const LEDGER_CODE_COLUMNS: Readonly<Record<string, string>> = {
  "ledger.accounts.type": "account type, one of five codes",
  "ledger.accounts.currency": "currency code",
  "ledger.accounts.owner_module": "owner module name",
  "ledger.accounts.service_kind": "service account kind, one of five codes",
  "ledger.entries.source_module": "source module name",
  "ledger.entries.event_type": "event type code",
  "ledger.entries.idempotency_key": "the source's event id (a code without spaces)",
  "ledger.postings.currency": "currency code (its accounts' currency)",
  "ledger.daily_balances.currency": "currency code (its account's currency)",
  "ledger.conversions.currency": "currency code (the account's, the rate's base)",
  "ledger.conversions.entry_currency": "currency code (the entry's, the rate's quote)",
  "ledger.conversions.rate_source": "who published the rate, a code (NBU, EU, synthetic)",
  "ledger.integrity_alerts.period": "kinds of failed checks with their counts",
  "ledger.outbox_events.event_name": "event name <module>.<event>",
  "ledger.outbox_events.payload": "identifiers, codes and dates of the event (every string a code)",
  "ledger.outbox_events.traceparent": "W3C trace context",
  "ledger.jobs.name": "job name <module>.<job>",
  "ledger.jobs.dedupe_key": "job key (an event id)",
  "ledger.jobs.payload": "identifiers, codes and dates of the job (every string a code)",
  "ledger.jobs.state": "job state, one of four codes",
  "ledger.jobs.last_error": "error class name",
  "ledger.jobs.traceparent": "W3C trace context",
};

const LEDGER_SCHEMA = "ledger";
/**
 * Deny by default (security review of #184): a ledger column is free of text only if its type, with every domain
 * resolved down to its base, is one of these or an enum. Anything else (text, bpchar, json, jsonpath, tsquery, an
 * array, a composite or range type, a domain over a domain…) must be a listed code column with its CHECK.
 */
const NON_TEXT_TYPES = new Set([
  "uuid",
  "boolean",
  "smallint",
  "integer",
  "bigint",
  "numeric",
  "date",
  "timestamp with time zone",
  "timestamp without time zone",
  "interval",
]);
/** A type name without its modifiers anywhere: `timestamp(3) with time zone` → `timestamp with time zone`. */
const stripTypmod = (base: string): string => base.replace(/\(\d+(,\d+)?\)/g, "");
/** Non-text type, with a length, precision or scale (`numeric(38,18)`, `timestamp(3) with time zone`, `interval day to second(3)`). */
const isNonTextType = (base: string): boolean => {
  const b = stripTypmod(base);
  return NON_TEXT_TYPES.has(b) || /^interval /.test(b);
};
/**
 * A CHECK that limits a column to a code: a list of values, or anchored regular expressions (`~ '^…$'`, or a jsonpath
 * `like_regex "^…$"`) without a wildcard that lets text through (`.*`, `.+`, `.{n,m}`, `[^…]`); never a LIKE (`~~`),
 * a negation (`!~`) or a condition widened by an OR (security review of #184).
 */
function isCodeCheck(def: string): boolean {
  if (/\bOR\b/.test(def) || /~~/.test(def)) return false;
  const patterns = [
    ...[...def.matchAll(/(?<![!~])~ '((?:[^']|'')*)'/g)].map((m) => m[1]!),
    ...[...def.matchAll(/like_regex "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!),
  ];
  const list = /= ANY \(/.test(def);
  if (patterns.length === 0) return list;
  return patterns.every(
    (p) =>
      p.startsWith("^") &&
      p.endsWith("$") &&
      !/(?<!\\)\.(?:[*+{]|$)|\[\^/.test(p.replace(/\[[^\]]*\]/g, (c) => (c.startsWith("[^") ? c : "[]"))),
  );
}

/**
 * Free text a code CHECK must refuse (security review of #184, round 2): a pattern check alone cannot tell `^[a-z]+$`
 * from `^\D*$`, `^(.)*$` or `^a|b$`, so every CHECK of a code column is also evaluated by PostgreSQL on these values
 * and must be false for each of them (a CHECK passes on true and on null). Codes never hold spaces or letters outside
 * ASCII.
 */
const FREE_TEXT_PROBES = [
  "a b",
  "кава",
  "Кава",
  "a\nb",
  "a\u00a0b",
  " ",
  "Кава в аеропорту Бориспіль, рейс до Варшави",
  "word ".repeat(39) + "end",
];
const FREE_TEXT_JSON_PROBES = FREE_TEXT_PROBES.flatMap((t) => [
  JSON.stringify({ note: t }),
  JSON.stringify({ id: "a1", note: t }), // a code beside the text: an «exists a code» CHECK lets it through
  JSON.stringify(["a1", t]),
  JSON.stringify({ a: { b: [t] } }),
  JSON.stringify([t]),
  JSON.stringify(t),
]);

/** True when PostgreSQL's own evaluation of the CHECK `expr` on `column` (of type `base`) lets any probe through. */
async function checkAcceptsFreeText(
  client: pg.ClientBase,
  attname: string,
  base: string,
  expr: string,
): Promise<boolean> {
  const probes = /^jsonb?$/.test(base)
    ? FREE_TEXT_JSON_PROBES
    : /^(text|character varying|citext)(\(\d+\))?$/.test(base)
      ? FREE_TEXT_PROBES
      : null;
  if (!probes) return true; // a type the probes cannot fill: not a code check
  const ident = `"${attname.replace(/"/g, '""')}"`;
  // The caller may be inside a transaction (tests, migrations): an error there must not abort it.
  let inTransaction = true;
  try {
    await client.query("SAVEPOINT ledger_free_text_probe");
  } catch {
    inTransaction = false;
  }
  try {
    for (const probe of probes) {
      try {
        const { rows } = await client.query<{ ok: boolean | null }>(
          `SELECT (${expr}) AS ok FROM (SELECT $1::${base} AS ${ident}) v`,
          [probe],
        );
        if (rows[0]?.ok !== false) return true;
      } catch {
        // The expression raises on this value, so an insert of it fails too: refused.
        if (inTransaction) {
          await client.query("ROLLBACK TO SAVEPOINT ledger_free_text_probe");
        }
      }
    }
    return false;
  } finally {
    if (inTransaction) await client.query("RELEASE SAVEPOINT ledger_free_text_probe");
  }
}

/** ARC-11 (issue #128): text-like columns of the ledger schema not in LEDGER_CODE_COLUMNS, or without their CHECK. */
export async function ledgerFreeTextProblems(client: pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<{
    column: string;
    attname: string;
    base: string;
    enum: boolean;
    checks: string[];
    exprs: string[];
  }>(
    `WITH RECURSIVE base(oid, start, typmod) AS (
         SELECT t.oid, t.oid, -1 FROM pg_type t
       UNION ALL
         SELECT t.typbasetype, b.start, t.typtypmod FROM base b JOIN pg_type t ON t.oid = b.oid WHERE t.typtype = 'd'
     ), resolved AS (
       SELECT b.start, b.oid, b.typmod FROM base b JOIN pg_type t ON t.oid = b.oid WHERE t.typtype <> 'd'
     )
     SELECT n.nspname || '.' || c.relname || '.' || a.attname AS column, a.attname,
            format_type(r.oid, CASE WHEN r.oid = a.atttypid THEN a.atttypmod ELSE r.typmod END) AS base,
            bt.typtype = 'e' AS enum,
            coalesce(array_agg(pg_get_constraintdef(k.oid) ORDER BY k.oid) FILTER (WHERE k.oid IS NOT NULL), '{}') AS checks,
            coalesce(array_agg(pg_get_expr(k.conbin, k.conrelid) ORDER BY k.oid) FILTER (WHERE k.oid IS NOT NULL), '{}')
              AS exprs
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN resolved r ON r.start = a.atttypid
       JOIN pg_type bt ON bt.oid = r.oid
       LEFT JOIN pg_constraint k ON k.conrelid = c.oid AND k.contype = 'c' AND k.conkey = ARRAY[a.attnum]
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND a.attnum > 0 AND NOT a.attisdropped
      GROUP BY 1, 2, 3, 4 ORDER BY 1`,
    [LEDGER_SCHEMA],
  );
  const problems: string[] = [];
  for (const r of rows) {
    if (r.enum || isNonTextType(r.base)) continue;
    if (!(r.column in LEDGER_CODE_COLUMNS))
      problems.push(
        `${r.column}: ${r.base} — no free text in the ledger (ARC-11: no descriptions, names or notes; texts live in the source module). A code column goes to LEDGER_CODE_COLUMNS in schema-rules.ts with a CHECK that limits it to a code`,
      );
    else if (!(await someCodeCheck(client, r)))
      problems.push(
        `${r.column}: a ledger code column needs a CHECK of its own that limits it to a code (a pattern, a list of values or a jsonpath like_regex) (ARC-11)`,
      );
  }
  return problems;
}

/** A CHECK of the column that is a code pattern and that PostgreSQL itself refuses every free-text probe with. */
async function someCodeCheck(
  client: pg.ClientBase,
  r: { attname: string; base: string; checks: string[]; exprs: string[] },
): Promise<boolean> {
  for (const [i, def] of r.checks.entries()) {
    if (isCodeCheck(def) && !(await checkAcceptsFreeText(client, r.attname, r.base, r.exprs[i]!)))
      return true;
  }
  return false;
}

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
  if (schemas.includes(LEDGER_SCHEMA)) problems.push(...(await ledgerFreeTextProblems(client)));
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
