import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../src/platform/db/migrate.ts";
import { schemaProblems } from "../src/platform/db/schema-rules.ts";
import { createTestDatabase } from "./db.ts";

/**
 * Review of PR #75, blocking 1: objects that a migration (run as the schema owner) creates outside the module
 * schema, or ownership handed to a module role, would bypass row policies. Each probe runs in its own
 * database; the migration run stops (assertIsolatedRoles, every deployment) and check:schema reports it.
 */

const fixtures = fileURLToPath(new URL("./fixtures/db-bypass", import.meta.url));
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function probe(module: string): Promise<{ migrateError: string; problems: string }> {
  const db = await createTestDatabase();
  const owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  cleanup.push(async () => {
    await owner.end();
    await db.drop();
  });
  const migrateError = await migrate(owner, { modules: [module], modulesDir: fixtures }).then(
    () => "",
    (e: Error) => e.message,
  );
  const problems = (await schemaProblems(owner, [module], { tables: {} })).join("\n");
  return { migrateError, problems };
}

describe("ARC-03 criterion «таблиця без політики рядків — 0»: no bypass outside module schemas", () => {
  it.each([
    [
      "a SECURITY DEFINER function in public granted to a module role",
      "probe-definer",
      [
        /ws_mod_probe_definer can execute SECURITY DEFINER function public\.all_records\(\)/,
        /ws_mod_probe_definer has privileges on function public\.all_records\(\)/,
      ],
    ],
    [
      "a view in public granted to a module role",
      "probe-view",
      [
        /ws_mod_probe_view has privileges on view public\.records_view/,
        /ws_mod_probe_view can use public\.records_view outside its schema/,
      ],
    ],
    [
      "a customer-data table without row security in public",
      "probe-public",
      [
        /public\.notes: no table may live in schema public/,
        /public\.notes: household_id outside the module schemas/,
        /ws_mod_probe_public has privileges on table public\.notes/,
      ],
    ],
    [
      "a module role made owner of its table",
      "probe-owner",
      [/ws_mod_probe_owner owns table probe_owner\.things/],
    ],
  ])("%s stops the migration run and fails check:schema", async (_, module, expected) => {
    const { migrateError, problems } = await probe(module);
    expect(migrateError).toMatch(/^Module roles must stay isolated: /);
    for (const pattern of expected) {
      expect(migrateError).toMatch(pattern);
      expect(problems).toMatch(pattern);
    }
  });
});
