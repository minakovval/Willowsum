import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/platform/db/migrate.ts";
import { ledgerFreeTextProblems } from "../src/platform/db/schema-rules.ts";
import { createTestDatabase } from "./db.ts";
import { migrateRealModules, realModulesDir } from "./real-modules.ts";

/**
 * ARC-11@PoC criterion «Тексти, описи або назви мерчантів у таблицях журналу» = 0, «Перевірка схеми у CI» (issue
 * #128): the schema rules (`pnpm check:schema` in CI, and the migration runner after every run) refuse a text-like
 * column in the ledger schema unless it is a listed code column with a CHECK that limits it to a code.
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

/** The problems the rule finds after `sql`, rolled back afterwards. */
async function problemsAfter(sql: string): Promise<string[]> {
  await owner.query("BEGIN");
  try {
    await owner.query(sql);
    return await ledgerFreeTextProblems(owner);
  } finally {
    await owner.query("ROLLBACK");
  }
}

describe("ARC-11@PoC criterion «Тексти, описи або назви мерчантів у таблицях журналу»: the CI schema check", () => {
  it("ARC-11@PoC criterion «Тексти, описи або назви мерчантів у таблицях журналу»: the real ledger schema has no free text", async () => {
    expect(await ledgerFreeTextProblems(owner)).toEqual([]);
  });

  it("ARC-11@PoC criterion «Тексти, описи або назви мерчантів у таблицях журналу»: a migration adding `description text` to ledger.entries fails", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ws-arc11-"));
    const scratch = await createTestDatabase();
    const client = new pg.Client({ connectionString: scratch.url });
    try {
      cpSync(path.join(realModulesDir, "ledger"), path.join(dir, "ledger"), { recursive: true });
      writeFileSync(
        path.join(dir, "ledger/adapters/db/migrations/0006_description.sql"),
        "ALTER TABLE entries ADD COLUMN description text;\n",
      );
      await client.connect();
      await expect(migrate(client, { modules: ["ledger"], modulesDir: dir })).rejects.toThrow(
        /ledger\.entries\.description: text — no free text in the ledger \(ARC-11/,
      );
    } finally {
      await client.end();
      await scratch.drop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "a varchar note, even with a CHECK",
      "ALTER TABLE ledger.entries ADD COLUMN memo varchar(40) CHECK (memo ~ '^.*$')",
      "ledger.entries.memo",
    ],
    [
      "a merchant name",
      "ALTER TABLE ledger.postings ADD COLUMN merchant_name text",
      "ledger.postings.merchant_name",
    ],
    ["JSON details", "ALTER TABLE ledger.postings ADD COLUMN details jsonb", "ledger.postings.details"],
    ["a list of tags", "ALTER TABLE ledger.accounts ADD COLUMN tags text[]", "ledger.accounts.tags"],
    ["a char column", "ALTER TABLE ledger.accounts ADD COLUMN flag char(1)", "ledger.accounts.flag"],
    [
      "a new table of notes",
      "CREATE TABLE ledger.notes (household_id uuid NOT NULL, body text)",
      "ledger.notes.body",
    ],
  ])(
    "ARC-11@PoC criterion «Тексти, описи або назви мерчантів у таблицях журналу»: %s is refused",
    async (_label, sql, column) => {
      const problems = await problemsAfter(sql);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(
        new RegExp(`^${column.replace(/\./g, "\\.")}: .* no free text in the ledger`),
      );
    },
  );

  it("ARC-11@PoC criterion «Тексти, описи або назви мерчантів у таблицях журналу»: a listed code column without its code CHECK is refused", async () => {
    for (const [sql, column] of [
      ["ALTER TABLE ledger.postings DROP CONSTRAINT postings_currency_code", "ledger.postings.currency"],
      [
        "ALTER TABLE ledger.outbox_events DROP CONSTRAINT outbox_events_payload_codes",
        "ledger.outbox_events.payload",
      ],
      // A length limit alone does not make a code.
      [
        "ALTER TABLE ledger.entries DROP CONSTRAINT entries_idempotency_key_code",
        "ledger.entries.idempotency_key",
      ],
    ] as const)
      expect(await problemsAfter(sql), column).toEqual([
        expect.stringMatching(
          new RegExp(`^${column.replace(/\./g, "\\.")}: a ledger code column needs a CHECK`),
        ),
      ]);
  });

  it("ARC-11@PoC criterion «Тексти, описи або назви мерчантів у таблицях журналу»: the code CHECKs refuse text in the stored rows", async () => {
    const household = "00000000-0000-4000-8000-000000000001";
    for (const sql of [
      `INSERT INTO ledger.entries (household_id, id, source_module, source_id, event_type, operation_date,
         rules_version, idempotency_key) VALUES ('${household}', gen_random_uuid(), 'transactions', gen_random_uuid(),
         'transaction', '2026-06-30', 1, 'Кава в аеропорту')`,
      `INSERT INTO ledger.jobs (household_id, name, dedupe_key, payload) VALUES ('${household}', 'ledger.x', 'k',
         '{"note": "Coffee shop"}')`,
      `INSERT INTO ledger.jobs (household_id, name, dedupe_key, payload, last_error) VALUES ('${household}',
         'ledger.x', 'k', '{}', 'card 4111 declined')`,
    ])
      await expect(problemsAfter(sql), sql).rejects.toMatchObject({ code: "23514" });
  });
});
