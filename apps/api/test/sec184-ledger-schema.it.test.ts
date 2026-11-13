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
  ])("sec184: a listed column whose only CHECK is %s is refused", async (_label, sql) => {
    expect(await problemsAfter(sql)).toEqual([
      expect.stringMatching(/^ledger\.entries\.idempotency_key: a ledger code column needs a CHECK/),
    ]);
  });
});
