/**
 * Migrations run «expand → migrate → contract» (ARC-03 FR 4, criterion «Міграція, несумісна з попередньою
 * версією коду — 0»). The new schema must work with the previous version of the code, which keeps running
 * while a deployment rolls out. So a migration may add (tables, nullable columns, columns with a default,
 * indexes) and move data, but an operation that can break the previous code — dropping or renaming an
 * object, changing a column type, making a column NOT NULL, adding a NOT NULL column without a default,
 * adding a constraint, truncating, dropping a trigger — is a *contract* step. A contract migration starts with
 *
 *   -- ws:contract <NNNN_expand.sql> <why the previous code no longer needs the object>
 *
 * naming the earlier expand migration of the same module after which the code stopped using the object; that
 * migration must already be in the base version (released before), so the contract ships in a later release.
 * Statements on tables created in the same file are not checked (nothing can depend on them yet). Applied
 * migrations are immutable: a file of the base version may not change or disappear.
 *
 * What this static rule does not catch (the dynamic CI step «old code + new schema» does, as far as the base
 * version's module tests reach): `ALTER COLUMN … DROP DEFAULT`, a new unique index or trigger on an
 * existing table, `DROP POLICY` and `DROP INDEX`, and any DDL hidden in `DO $$ … EXECUTE … $$`. Policies are
 * re-checked by check:schema; everything else relies on the base version's tests and on review.
 */

export interface MigrationFile {
  readonly module: string;
  readonly name: string;
  readonly sql: string;
}

export interface BaseVersion {
  /** The base version's text of that migration, or undefined when the base has no such file. */
  readonly sql: (module: string, name: string) => string | undefined;
  readonly files: readonly { module: string; name: string }[];
}

const CONTRACT_RE = /^--\s*ws:contract\s+(\d{4}_[a-z0-9_]+\.sql)\s+\S.*$/m;

/** SQL without comments, string literals and dollar-quoted bodies (function bodies may say «DROP …»). */
export function stripSql(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollar) {
      const end = sql.indexOf(dollar[0], i + dollar[0].length);
      i = end === -1 ? sql.length : end + dollar[0].length;
      out += " '' ";
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      i = j + 1;
      out += " '' ";
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

const ident = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_$]*))?`;
const unquote = (name: string): string => name.replaceAll('"', "").split(".").pop()!;

/** Contract operations of one statement on a table not created in the same file; empty when expand-only. */
function contractOperations(statement: string, createdHere: ReadonlySet<string>): string[] {
  const s = statement.replace(/\s+/g, " ").trim().toLowerCase();
  const found: string[] = [];
  const drop = new RegExp(
    String.raw`^drop (table|view|materialized view|schema|type|domain|function|procedure|sequence|trigger)\b`,
  ).exec(s);
  if (drop) found.push(`DROP ${drop[1]!.toUpperCase()}`);
  if (/^truncate\b/.test(s)) found.push("TRUNCATE");
  const alter = new RegExp(
    String.raw`^alter (table|view|materialized view|type|domain|function|procedure|sequence) (?:if exists )?(?:only )?(${ident}(?:\([^)]*\))?) (.*)$`,
  ).exec(s);
  if (alter && !createdHere.has(unquote(alter[2]!.replace(/\(.*$/, "")))) {
    // Actions are separated by top-level commas: «ALTER TABLE t ADD COLUMN a int, DROP COLUMN b».
    for (const action of alter[3]!.split(/,(?![^(]*\))/).map((x) => x.trim())) {
      if (/^rename\b/.test(action)) found.push("RENAME");
      else if (/^set schema\b/.test(action)) found.push("SET SCHEMA");
      else if (/^drop (?!constraint\b)/.test(action)) found.push("DROP COLUMN");
      else if (/^alter (?:column )?\S+ (?:set data )?type\b/.test(action)) found.push("ALTER COLUMN … TYPE");
      else if (/^alter (?:column )?\S+ set not null\b/.test(action)) found.push("SET NOT NULL");
      else if (/^add (?:constraint|check|unique|primary key|foreign key|exclude)\b/.test(action))
        found.push("ADD CONSTRAINT");
      else if (
        /^add\b/.test(action) &&
        /\bnot null\b/.test(action) &&
        !/\bdefault\b|\bgenerated\b/.test(action)
      )
        found.push("ADD COLUMN … NOT NULL without DEFAULT");
    }
  }
  return found;
}

export function migrationCompatProblems(files: readonly MigrationFile[], base?: BaseVersion): string[] {
  const problems: string[] = [];
  for (const file of files) {
    const at = `${file.module}/${file.name}`;
    const stripped = stripSql(file.sql);
    const createdHere = new Set(
      [
        ...stripped.matchAll(
          new RegExp(String.raw`create (?:unlogged )?table (?:if not exists )?(${ident})`, "gi"),
        ),
      ].map((m) => unquote(m[1]!.toLowerCase())),
    );
    const operations = stripped.split(";").flatMap((st) => contractOperations(st, createdHere));
    if (operations.length === 0) continue;
    const marker = CONTRACT_RE.exec(file.sql);
    if (!marker) {
      problems.push(
        `${at}: ${[...new Set(operations)].join(", ")} can break the previous version of the code; ` +
          "expand first, and contract in a later release with «-- ws:contract <NNNN_expand.sql> <reason>»",
      );
      continue;
    }
    const expand = marker[1]!;
    if (expand >= file.name || !files.some((f) => f.module === file.module && f.name === expand)) {
      problems.push(
        `${at}: ws:contract names ${expand}, which is not an earlier migration of ${file.module}`,
      );
    } else if (base && base.sql(file.module, expand) === undefined) {
      problems.push(`${at}: ${expand} is not released yet; the contract step goes into a later release`);
    }
  }
  if (base) {
    for (const { module, name } of base.files) {
      const now = files.find((f) => f.module === module && f.name === name);
      if (!now) problems.push(`${module}/${name}: an applied migration may not be removed`);
      else if (now.sql !== base.sql(module, name))
        problems.push(`${module}/${name}: an applied migration may not change; add a new migration`);
    }
  }
  return problems;
}
