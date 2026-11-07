/**
 * What may be reported about a database error (NFR-10 FR 2, ADR-0006): the SQLSTATE and the names of the
 * constraint, table, column and schema — the fields PostgreSQL sends for them. Never the message, `detail`
 * (it repeats the values, e.g. «Key (name)=(Картка Золота) already exists»), `where`, `hint`, the query or
 * its parameters.
 */
export interface DatabaseErrorFields {
  readonly sqlState: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
  readonly schema?: string;
}

const SQLSTATE_RE = /^[0-9A-Z]{5}$/;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;

/** The reportable fields of a PostgreSQL error (driver `DatabaseError`), or undefined for any other error. */
export function databaseErrorFields(error: unknown): DatabaseErrorFields | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as Record<string, unknown>;
  // node-postgres puts the server's fields on the error: `code` is the SQLSTATE.
  if (typeof e["code"] !== "string" || !SQLSTATE_RE.test(e["code"]) || !("severity" in e)) return undefined;
  const name = (key: string): Partial<Record<string, string>> => {
    const value = e[key];
    return typeof value === "string" && IDENTIFIER_RE.test(value) ? { [key]: value } : {};
  };
  return {
    sqlState: e["code"],
    ...name("constraint"),
    ...name("table"),
    ...name("column"),
    ...name("schema"),
  };
}

/** The same fields as telemetry attributes. */
export function databaseErrorAttributes(fields: DatabaseErrorFields): Record<string, string> {
  return {
    "db.system.name": "postgresql",
    "db.response.status_code": fields.sqlState,
    ...(fields.constraint ? { "ws.db.constraint": fields.constraint } : {}),
    ...(fields.table ? { "ws.db.table": fields.table } : {}),
    ...(fields.column ? { "ws.db.column": fields.column } : {}),
    ...(fields.schema ? { "ws.db.schema": fields.schema } : {}),
  };
}
