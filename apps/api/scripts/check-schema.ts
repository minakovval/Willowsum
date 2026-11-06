/**
 * CI schema check (ARC-03): migrates every module into a throw-away database on DATABASE_URL (superuser)
 * and checks household isolation, amounts, time and region rules (src/platform/db/schema-rules.ts).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/platform/db/migrate.ts";
import { schemaProblems, type SchemaExemptions } from "../src/platform/db/schema-rules.ts";
import { topologicalOrder, type ModuleRules } from "../src/platform/modules/rules.ts";
import { createTestDatabase } from "../test/db.ts";

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")) as T;
const modules = topologicalOrder(read<ModuleRules>("../module-rules.json"));
const db = await createTestDatabase();
const client = new pg.Client({ connectionString: db.url });
let problems: string[];
try {
  await client.connect();
  await migrate(client, { modules, modulesDir: fileURLToPath(new URL("../src/modules", import.meta.url)) });
  problems = await schemaProblems(client, modules, read<SchemaExemptions>("../schema-exemptions.json"));
} finally {
  await client.end();
  await db.drop();
}
if (problems.length > 0) {
  console.error(`Schema rules violated (ARC-03):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`Schema rules: ok (${modules.length} modules)`);
