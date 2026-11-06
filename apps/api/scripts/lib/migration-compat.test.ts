import { describe, expect, it } from "vitest";
import { migrationCompatProblems, stripSql, type MigrationFile } from "./migration-compat.ts";

const create = {
  module: "ledger",
  name: "0001_entries.sql",
  sql: "CREATE TABLE entries (id uuid, note text, amount numeric(38,18));",
};
const file = (name: string, sql: string): MigrationFile => ({ module: "ledger", name, sql });
const problemsOf = (sql: string) => migrationCompatProblems([create, file("0002_change.sql", sql)]);

describe("ARC-03 FR 4 / criterion «міграція, несумісна з попередньою версією коду — 0»", () => {
  it.each([
    "ALTER TABLE entries ADD COLUMN memo text",
    "ALTER TABLE entries ADD COLUMN state text NOT NULL DEFAULT 'open'",
    "ALTER TABLE entries ADD COLUMN seq bigint NOT NULL GENERATED ALWAYS AS IDENTITY",
    "CREATE INDEX entries_note ON entries (note)",
    "DROP INDEX entries_note",
    "UPDATE entries SET note = 'x' WHERE note IS NULL",
    "ALTER TABLE entries ALTER COLUMN note DROP NOT NULL",
    "ALTER TABLE entries DROP CONSTRAINT entries_check",
    "CREATE TABLE fresh (id int); ALTER TABLE fresh RENAME COLUMN id TO key; ALTER TABLE fresh ADD COLUMN v int NOT NULL",
    "CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'DROP TABLE entries'; END $$",
    "-- DROP TABLE entries\nSELECT 1",
  ])("expand and migrate steps pass: %s", (sql) => {
    expect(problemsOf(sql)).toEqual([]);
  });

  it.each([
    ["DROP TABLE entries", "DROP TABLE"],
    ["ALTER TABLE entries DROP COLUMN note", "DROP COLUMN"],
    ["ALTER TABLE entries DROP note", "DROP COLUMN"],
    ["ALTER TABLE entries RENAME COLUMN note TO memo", "RENAME"],
    ["ALTER TABLE entries RENAME TO lines", "RENAME"],
    ["ALTER TABLE entries ALTER COLUMN note TYPE varchar(10)", "ALTER COLUMN … TYPE"],
    ["ALTER TABLE entries ALTER note SET DATA TYPE varchar(10)", "ALTER COLUMN … TYPE"],
    ["ALTER TABLE entries ALTER COLUMN note SET NOT NULL", "SET NOT NULL"],
    ["ALTER TABLE entries ADD COLUMN state text NOT NULL", "ADD COLUMN … NOT NULL without DEFAULT"],
    ["ALTER TABLE entries ADD CONSTRAINT positive CHECK (amount > 0)", "ADD CONSTRAINT"],
    ["ALTER TABLE entries ADD COLUMN a int, DROP COLUMN note", "DROP COLUMN"],
    ["TRUNCATE entries", "TRUNCATE"],
    ["DROP TRIGGER entries_append_only ON entries", "DROP TRIGGER"],
    ['ALTER TABLE ledger."entries" SET SCHEMA other', "SET SCHEMA"],
  ])("a contract step without the marker fails: %s", (sql, operation) => {
    const [problem] = problemsOf(sql);
    expect(problem).toContain(operation);
    expect(problem).toMatch(/^ledger\/0002_change.sql: .*expand first/);
  });

  it("a contract step names an earlier, already released expand migration", () => {
    const expand = file(
      "0002_memo.sql",
      "ALTER TABLE entries ADD COLUMN memo text; UPDATE entries SET memo = note;",
    );
    const contract = file(
      "0003_drop_note.sql",
      "-- ws:contract 0002_memo.sql the code reads memo since 0002\nALTER TABLE entries DROP COLUMN note;",
    );
    const released = (names: string[]) => ({
      files: names.map((name) => ({ module: "ledger", name })),
      sql: (_: string, name: string) =>
        [create, expand, contract].find((f) => f.name === name && names.includes(name))?.sql,
    });
    expect(
      migrationCompatProblems([create, expand, contract], released(["0001_entries.sql", "0002_memo.sql"])),
    ).toEqual([]);
    expect(migrationCompatProblems([create, expand, contract], released(["0001_entries.sql"]))).toEqual([
      "ledger/0003_drop_note.sql: 0002_memo.sql is not released yet; the contract step goes into a later release",
    ]);
    const self = file(
      "0003_drop_note.sql",
      "-- ws:contract 0003_drop_note.sql oops\nALTER TABLE entries DROP COLUMN note;",
    );
    expect(migrationCompatProblems([create, expand, self])[0]).toMatch(/not an earlier migration/);
  });

  it("an applied migration may not change or disappear", () => {
    const base = {
      files: [{ module: "ledger", name: "0001_entries.sql" }],
      sql: () => "CREATE TABLE entries (id uuid);",
    };
    expect(migrationCompatProblems([create], base)).toEqual([
      "ledger/0001_entries.sql: an applied migration may not change; add a new migration",
    ]);
    expect(migrationCompatProblems([], base)).toEqual([
      "ledger/0001_entries.sql: an applied migration may not be removed",
    ]);
  });

  it("comments, strings and dollar-quoted bodies are not statements", () => {
    expect(stripSql("SELECT 'it''s; DROP TABLE x' /* DROP */ -- DROP\n, $f$DROP$f$")).not.toMatch(/DROP/);
  });
});
