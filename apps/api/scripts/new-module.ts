/**
 * Creates a backend module (ARC-01): pnpm --filter @willowsum/api new-module <name> [--depends a,b] [--layer platform|subject|process]
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readCatalogue, type ModuleLayer } from "../src/platform/modules/catalogue.ts";
import { scaffoldModule } from "./lib/scaffold.ts";

const apiDir = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { depends: { type: "string", default: "" }, layer: { type: "string" } },
});
const name = positionals[0];
if (!name) {
  console.error("Usage: new-module <name> [--depends a,b] [--layer platform|subject|process]");
  process.exit(2);
}
try {
  const created = scaffoldModule({
    apiDir,
    name,
    dependsOn: values.depends
      ? values.depends
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    ...(values.layer ? { layer: values.layer as ModuleLayer } : {}),
    catalogue: readCatalogue(repoRoot),
  });
  console.log(
    `Module ${name} created:\n  ${created.join("\n  ")}\nRegistered in module-rules.json and src/modules/index.ts.`,
  );
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
