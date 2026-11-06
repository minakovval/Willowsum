/**
 * Applies migrations of all modules in dependency order (ARC-01, ARC-03). Connects with DATABASE_URL as
 * the migration (schema owner) role — never as ws_app.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/platform/db/migrate.ts";
import { topologicalOrder, type ModuleRules } from "../src/platform/modules/rules.ts";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}
const rules = JSON.parse(
  readFileSync(new URL("../module-rules.json", import.meta.url), "utf8"),
) as ModuleRules;
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { applied } = await migrate(client, {
    modules: topologicalOrder(rules),
    modulesDir: fileURLToPath(new URL("../src/modules", import.meta.url)),
  });
  console.log(applied.length > 0 ? `Applied:\n  ${applied.join("\n  ")}` : "Nothing to apply");
} finally {
  await client.end();
}
