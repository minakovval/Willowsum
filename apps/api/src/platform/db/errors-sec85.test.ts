import pg from "pg";
import { describe, expect, it } from "vitest";
import { databaseErrorFields } from "./errors.ts";

/** Security review of PR #85 (NFR-10 FR 2): every other field of a node-postgres error stays out. */
describe("sec85: database error fields", () => {
  it("message, detail, hint, where, internalQuery, position, routine, file, line, dataType never leave", () => {
    const error = new pg.DatabaseError(`invalid input syntax for type numeric: "1 234,56 грн"`, 0, "error");
    Object.assign(error, {
      severity: "ERROR",
      code: "22P02",
      detail: "Failing row contains (Картка Золота).",
      hint: "olha@example.com",
      where: "unnamed portal parameter $1 = '1 234,56 грн'",
      internalQuery: "select 'Картка Золота'::int",
      internalPosition: "8",
      position: "12",
      routine: "numeric_in",
      file: "numeric.c",
      line: "800",
      dataType: "numeric",
      table: "accounts",
    });
    expect(databaseErrorFields(error)).toEqual({ sqlState: "22P02", table: "accounts" });
  });

  it("a Node system error with a five-letter code (EPIPE, EPERM) is not a database error", () => {
    for (const code of ["EPIPE", "EPERM", "EBADF"])
      expect(databaseErrorFields(Object.assign(new Error("x"), { code, table: "accounts" }))).toBeUndefined();
  });
});
