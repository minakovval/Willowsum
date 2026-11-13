import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerFreeTextProblems } from "../src/platform/db/schema-rules.ts";
import { createTestDatabase } from "./db.ts";
import { migrateRealModules } from "./real-modules.ts";

/**
 * Security review of #184 (ARC-11@PoC criterion «Тексти, описи або назви мерчантів у таблицях журналу» = 0, issue
 * #128): the CI rule must refuse every way to add free text to the ledger schema, not only the type names it lists.
 */

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
});

afterAll(async () => {
  await owner?.end();
  await db?.drop();
});

async function problemsAfter(sql: string): Promise<string[]> {
  await owner.query("BEGIN");
  try {
    await owner.query(sql);
    return await ledgerFreeTextProblems(owner);
  } finally {
    await owner.query("ROLLBACK");
  }
}

const KEY =
  "ALTER TABLE ledger.entries DROP CONSTRAINT entries_idempotency_key_code; ALTER TABLE ledger.entries ADD CONSTRAINT k";

describe("sec184: the ledger free-text rule is deny-by-default", () => {
  it("sec184: the real ledger schema still passes", async () => {
    expect(await ledgerFreeTextProblems(owner)).toEqual([]);
  });

  it.each([
    ["bpchar without a length", "ALTER TABLE ledger.entries ADD COLUMN memo bpchar"],
    [
      "a domain over a domain over text",
      "CREATE DOMAIN ledger.t1 AS text; CREATE DOMAIN ledger.t2 AS ledger.t1; ALTER TABLE ledger.entries ADD COLUMN memo ledger.t2",
    ],
    [
      "a composite type with a text field",
      "CREATE TYPE ledger.note AS (body text); ALTER TABLE ledger.entries ADD COLUMN memo ledger.note",
    ],
    ["jsonpath", "ALTER TABLE ledger.entries ADD COLUMN memo jsonpath"],
    ["tsquery", "ALTER TABLE ledger.entries ADD COLUMN memo tsquery"],
    [
      "a range over text",
      "CREATE TYPE ledger.tr AS RANGE (subtype = text); ALTER TABLE ledger.entries ADD COLUMN memo ledger.tr",
    ],
  ])("sec184: an unlisted %s column is refused", async (_label, sql) => {
    expect(await problemsAfter(sql)).toEqual([
      expect.stringMatching(/^ledger\.entries\.memo: .* no free text in the ledger/),
    ]);
  });

  it.each([
    ["a LIKE", `${KEY} CHECK (idempotency_key LIKE '%')`],
    ["a NOT LIKE", `${KEY} CHECK (idempotency_key NOT LIKE 'x')`],
    ["a match-all regex", `${KEY} CHECK (idempotency_key ~ '.*')`],
    ["an anchored match-all regex", `${KEY} CHECK (idempotency_key ~ '^.{0,1000}$')`],
    ["a regex widened by OR", `${KEY} CHECK (idempotency_key ~ '^a$' OR true)`],
    ["a negated anchored regex", `${KEY} CHECK (idempotency_key !~ '^a$')`],
    ["a NOT around an anchored regex", `${KEY} CHECK (NOT (idempotency_key ~ '^a$'))`],
    ["an unanchored character class", `${KEY} CHECK (idempotency_key ~ '[A-Za-z0-9]')`],
    ["any printable character by a class", `${KEY} CHECK (idempotency_key ~ '^[[:print:]]{0,255}$')`],
    ["anything but digits", `${KEY} CHECK (idempotency_key ~ '^\\D*$')`],
    ["an alternation that splits the anchors", `${KEY} CHECK (idempotency_key ~ '^a|b$')`],
    ["letters and spaces", `${KEY} CHECK (idempotency_key ~ '^[a-zA-Z ]+$')`],
    ["Cyrillic letters and spaces", `${KEY} CHECK (idempotency_key ~ '^[а-яА-ЯіїєґІЇЄҐa-z ,]+$')`],
    ["a dot inside a group", `${KEY} CHECK (idempotency_key ~ '^(.)*$')`],
    ["optional dots", `${KEY} CHECK (idempotency_key ~ '^.?.?.?.?.?.?.?.?$')`],
    [
      "a CASE that is null (so passes) for text",
      `${KEY} CHECK (CASE WHEN idempotency_key ~ '^[a-z]+$' THEN true END)`,
    ],
    ["no whitespace only", `${KEY} CHECK (idempotency_key ~ '^\\S+$')`],
    [
      "a CASE that waives the pattern for long values",
      `${KEY} CHECK (CASE WHEN length(idempotency_key) > 2 THEN true ELSE idempotency_key ~ '^a$' END)`,
    ],
  ])("sec184: a listed column whose only CHECK is %s is refused", async (_label, sql) => {
    expect(await problemsAfter(sql)).toEqual([
      expect.stringMatching(/^ledger\.entries\.idempotency_key: a ledger code column needs a CHECK/),
    ]);
  });

  it("sec184: interval and timestamp(n) with or without time zone are non-text, whatever their modifier", async () => {
    expect(
      await problemsAfter(
        `ALTER TABLE ledger.entries ADD COLUMN t1 timestamp(3) with time zone, ADD COLUMN t2 timestamp(0) without time zone, ADD COLUMN t3 interval, ADD COLUMN t4 interval(2), ADD COLUMN t5 interval day to second(3)`,
      ),
    ).toEqual([]);
  });

  it("sec184: a JSON CHECK that asks only that some string is a code is refused", async () => {
    expect(
      await problemsAfter(
        `ALTER TABLE ledger.jobs DROP CONSTRAINT jobs_payload_codes; ALTER TABLE ledger.jobs ADD CONSTRAINT p CHECK (jsonb_path_exists(payload, '$.** ? (@ like_regex "^[a-z0-9]+$")'))`,
      ),
    ).toEqual([expect.stringMatching(/^ledger\.jobs\.payload: a ledger code column needs a CHECK/)]);
  });

  it("sec184: a strict code CHECK passes inside a transaction, and a CHECK that raises on text neither fails nor aborts it", async () => {
    expect(await problemsAfter(`${KEY} CHECK (idempotency_key ~ '^[A-Za-z0-9:._-]{1,200}$')`)).toEqual([]);
    await owner.query("BEGIN");
    try {
      await owner.query(`${KEY} CHECK ((idempotency_key::int)::text ~ '^[0-9]{1,9}$')`);
      expect(await ledgerFreeTextProblems(owner)).toEqual([]);
      expect((await owner.query("SELECT 1 AS one")).rows).toEqual([{ one: 1 }]);
    } finally {
      await owner.query("ROLLBACK");
    }
  });
});
