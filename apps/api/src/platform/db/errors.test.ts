import pg from "pg";
import { describe, expect, it } from "vitest";
import { databaseErrorAttributes, databaseErrorFields } from "./errors.ts";

describe("NFR-10 FR 2: a database error is reported only by SQLSTATE and names", () => {
  it("keeps the SQLSTATE, constraint, table, column and schema; never the message, detail, where or hint", () => {
    const error = new pg.DatabaseError("null value in column violates not-null constraint", 0, "error");
    Object.assign(error, {
      severity: "ERROR",
      code: "23502",
      detail: "Failing row contains (Картка Золота, -1234.56, null).",
      where: "SQL function",
      hint: "olha@example.com",
      table: "accounts",
      column: "balance_currency",
      schema: "wallets",
    });
    const fields = databaseErrorFields(error);
    expect(fields).toEqual({
      sqlState: "23502",
      table: "accounts",
      column: "balance_currency",
      schema: "wallets",
    });
    expect(databaseErrorAttributes(fields!)).toEqual({
      "db.system.name": "postgresql",
      "db.response.status_code": "23502",
      "ws.db.table": "accounts",
      "ws.db.column": "balance_currency",
      "ws.db.schema": "wallets",
    });
  });

  it("a name that is not an SQL identifier is left out; other errors have no database fields", () => {
    const error = Object.assign(new Error("x"), {
      severity: "ERROR",
      code: "23505",
      constraint: "name (Картка Золота)",
      table: "accounts",
    });
    expect(databaseErrorFields(error)).toEqual({ sqlState: "23505", table: "accounts" });
    expect(databaseErrorFields(new Error("plain"))).toBeUndefined();
    expect(databaseErrorFields(Object.assign(new Error("fs"), { code: "ENOENT" }))).toBeUndefined();
    expect(databaseErrorFields(null)).toBeUndefined();
  });
});
