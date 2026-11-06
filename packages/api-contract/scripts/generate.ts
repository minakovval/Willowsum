/**
 * Generates the typed client's types (`src/schema.ts`) from the committed contract `openapi.json`
 * (ARC-07 FR 2). `--check` fails when the committed types differ from what the contract gives (CI job `api`).
 *
 *   node scripts/generate.ts           write src/schema.ts
 *   node scripts/generate.ts --check   compare only
 */
import { readFileSync, writeFileSync } from "node:fs";
import openapiTS, { astToString } from "openapi-typescript";

const contractUrl = new URL("../openapi.json", import.meta.url);
const schemaUrl = new URL("../src/schema.ts", import.meta.url);

export async function generateTypes(contract: string): Promise<string> {
  const ast = await openapiTS(JSON.parse(contract) as Parameters<typeof openapiTS>[0], {
    alphabetize: true,
    exportType: true,
  });
  return [
    "// Generated from openapi.json by scripts/generate.ts (ARC-07). Do not edit: run",
    "// `pnpm contract:write` from the repository root.",
    "",
    astToString(ast),
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const generated = await generateTypes(readFileSync(contractUrl, "utf8"));
  if (process.argv.includes("--check")) {
    let committed = "";
    try {
      committed = readFileSync(schemaUrl, "utf8");
    } catch {
      // missing file: reported below
    }
    if (committed !== generated) {
      console.error(
        "packages/api-contract/src/schema.ts does not match openapi.json. Run `pnpm contract:write` and commit the result.",
      );
      process.exit(1);
    }
    console.log("Typed client: up to date with openapi.json");
  } else {
    writeFileSync(schemaUrl, generated);
    console.log("Wrote packages/api-contract/src/schema.ts");
  }
}
