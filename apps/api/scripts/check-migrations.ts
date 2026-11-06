/**
 * CI gate for «expand → migrate → contract» (ARC-03 FR 4): pnpm --filter @willowsum/api check:migrations.
 * WS_MIGRATION_BASE_DIR, when set, is a checkout of the base version (CI: the PR's base commit): its
 * migrations are released, so they may not change, and a contract step may only follow them.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrations } from "../src/platform/db/migrate.ts";
import { topologicalOrder, type ModuleRules } from "../src/platform/modules/rules.ts";
import { migrationCompatProblems, type BaseVersion } from "./lib/migration-compat.ts";

const apiDir = fileURLToPath(new URL("..", import.meta.url));
const modulesOf = (dir: string): string[] =>
  existsSync(path.join(dir, "module-rules.json"))
    ? topologicalOrder(JSON.parse(readFileSync(path.join(dir, "module-rules.json"), "utf8")) as ModuleRules)
    : [];
const files = readMigrations({ modules: modulesOf(apiDir), modulesDir: path.join(apiDir, "src/modules") });

let base: BaseVersion | undefined;
const baseDir = process.env["WS_MIGRATION_BASE_DIR"];
if (baseDir) {
  const baseApi = path.join(baseDir, "apps/api");
  const released = readMigrations({
    modules: modulesOf(baseApi),
    modulesDir: path.join(baseApi, "src/modules"),
  });
  base = {
    files: released,
    sql: (module, name) => released.find((m) => m.module === module && m.name === name)?.sql,
  };
}
const problems = migrationCompatProblems(files, base);
if (problems.length > 0) {
  console.error(
    `Migrations must stay compatible with the previous code (ARC-03 FR 4):\n  ${problems.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(
  `Migration compatibility: ok (${files.length} migrations${base ? `, ${base.files.length} released` : ""})`,
);
