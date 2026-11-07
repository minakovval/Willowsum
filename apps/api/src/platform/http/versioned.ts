import type { HouseholdQueryRunner } from "../db/module-db.ts";
import { ApiProblem } from "./problem.ts";

/**
 * Optimistic concurrency of record updates (NFR-15 FR 13; ADR-0007). A versioned table has an integer
 * `version` column; a client sends the version it read with its change. The update applies only when the
 * stored version is still that one, and raises the version by one. Otherwise nothing is written and the API
 * answers 409 VERSION_CONFLICT with the current version and `changedFields`: the fields someone else changed
 * since the client read the record. For that the client sends `base` — the values it read at
 * `expectedVersion`, for the fields it shows or edits — and a field is reported when its stored value IS
 * DISTINCT FROM its base value. Only field names leave the server, never values.
 *
 * - Only fields of the table's `readable` set are compared: a field the caller may write but not read would
 *   otherwise confirm or refute a guessed value. `base` entries for other fields are ignored. Whether this
 *   caller may read a field is the module's decision: it passes `base` only for such fields.
 * - A field the client left out of `base` is never reported, even if it changed (the client did not show it).
 * - The route validates `base` with the same schemas as the change: its values reach SQL as parameters typed
 *   by the column.
 *
 * A record the caller cannot see is 404 (DAT-05), never a conflict. Identifiers come only from the table spec
 * (checked at declaration); values only as query parameters.
 */
const IDENTIFIER_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const FIELD_RE = /^[a-z][A-Za-z0-9]{0,63}$/;
/** The largest value of the `version integer` column. */
const MAX_VERSION = 2_147_483_647;

export interface VersionedTableSpec {
  /** Table in the module's own schema (the search path of a module transaction). */
  readonly table: string;
  /** API field name → column. Only these fields may change. */
  readonly fields: Readonly<Record<string, string>>;
  /**
   * Fields whose change may be reported in `changedFields` (a subset of `fields`): those the module lets its
   * callers read. A write-only field is never compared.
   */
  readonly readable: readonly string[];
  readonly idColumn?: string;
  readonly versionColumn?: string;
}

export interface VersionedTable {
  readonly table: string;
  readonly fields: ReadonlyMap<string, string>;
  readonly readable: ReadonlySet<string>;
  readonly idColumn: string;
  readonly versionColumn: string;
}

const quote = (identifier: string): string => `"${identifier}"`;

/** Declares a versioned table; refuses identifiers that are not plain lower-case SQL names. */
export function defineVersionedTable(spec: VersionedTableSpec): VersionedTable {
  const idColumn = spec.idColumn ?? "id";
  const versionColumn = spec.versionColumn ?? "version";
  for (const identifier of [spec.table, idColumn, versionColumn, ...Object.values(spec.fields)])
    if (!IDENTIFIER_RE.test(identifier))
      throw new Error(`versioned table: ${identifier} is not an identifier`);
  const columns = new Set<string>();
  for (const [field, column] of Object.entries(spec.fields)) {
    if (!FIELD_RE.test(field))
      throw new Error(`versioned table ${spec.table}: field ${field} is not camelCase`);
    if ([idColumn, versionColumn, "household_id"].includes(column) || columns.has(column))
      throw new Error(`versioned table ${spec.table}: column ${column} cannot be a field`);
    columns.add(column);
  }
  if (columns.size === 0) throw new Error(`versioned table ${spec.table}: no fields`);
  for (const field of spec.readable)
    if (!Object.hasOwn(spec.fields, field))
      throw new Error(`versioned table ${spec.table}: readable ${field} is not a field`);
  return Object.freeze({
    table: spec.table,
    fields: new Map(Object.entries(spec.fields)),
    readable: new Set(spec.readable),
    idColumn,
    versionColumn,
  });
}

/**
 * Updates one record of the caller's household if its version is `expectedVersion`; returns the new version.
 * Throws 404 NOT_FOUND when there is no such record for the caller and 409 VERSION_CONFLICT when its version
 * differs, with the readable fields whose stored value differs from `base` (the values read at that version).
 */
export async function updateVersioned(
  q: HouseholdQueryRunner,
  table: VersionedTable,
  id: string,
  expectedVersion: number,
  changes: Readonly<Record<string, unknown>>,
  base: Readonly<Record<string, unknown>>,
): Promise<{ version: number }> {
  // The version column is a PostgreSQL integer: a larger number is a client error, never a database one (500).
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion > MAX_VERSION)
    throw new ApiProblem("VALIDATION_FAILED", {
      errors: [{ in: "body", path: "version", issue: "invalid_type" }],
    });
  const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
  if (entries.length === 0) throw new Error(`versioned update of ${table.table}: nothing to change`);
  const columns = entries.map(([field]) => {
    const column = table.fields.get(field);
    if (column === undefined) throw new Error(`versioned update of ${table.table}: ${field} is not a field`);
    return column;
  });
  const values = entries.map(([, value]) => value);
  const t = quote(table.table);
  const v = quote(table.versionColumn);
  const where = `household_id = $1 AND ${quote(table.idColumn)} = $2`;
  const updated = await q.query<{ version: number | string }>(
    `UPDATE ${t} SET ${columns.map((c, i) => `${quote(c)} = $${i + 4}`).join(", ")}, ${v} = ${v} + 1
     WHERE ${where} AND ${v} = $3 RETURNING ${v} AS version`,
    [q.householdId, id, expectedVersion, ...values],
  );
  const row = updated.rows[0];
  if (updated.rowCount === 1 && row) return { version: Number(row.version) };
  // Only declared, readable fields the client read (own keys only: never `__proto__` or other inherited names).
  const compared = Object.entries(base).filter(
    ([field, value]) =>
      value !== undefined && table.readable.has(field) && table.fields.get(field) !== undefined,
  );
  const comparisons = compared.map(
    ([field], i) => `${quote(table.fields.get(field) as string)} IS DISTINCT FROM $${i + 3} AS d${i}`,
  );
  const current = await q.query<Record<string, unknown> & { version: number | string }>(
    `SELECT ${[`${v} AS version`, ...comparisons].join(", ")} FROM ${t} WHERE ${where}`,
    [q.householdId, id, ...compared.map(([, value]) => value)],
  );
  const found = current.rows[0];
  if (!found) throw new ApiProblem("NOT_FOUND");
  throw new ApiProblem("VERSION_CONFLICT", {
    extensions: {
      currentVersion: Number(found.version),
      changedFields: compared.filter((_, i) => found[`d${i}`] === true).map(([field]) => field),
    },
  });
}
