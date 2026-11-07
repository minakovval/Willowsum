import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { catalogueProblems, type EventSnapshot } from "../../src/platform/events/catalogue.ts";
import { readCatalogue } from "../../src/platform/modules/catalogue.ts";
import type { ModuleDefinition } from "../../src/platform/modules/define.ts";
import { validateRules, type ModuleRules } from "../../src/platform/modules/rules.ts";
import { analyzeImports, analyzeWorkspaceSdks } from "./analyze.ts";
import { readProviderSdks } from "./provider-sdks.ts";

/**
 * Everything ARC-01 asks CI to stop: rules file errors (unknown modules, cycles, wrong direction),
 * undeclared or incomplete module folders, forbidden imports, incompatible event schemas.
 */
export async function checkModules(apiDir: string, repoRoot: string): Promise<string[]> {
  const problems: string[] = [];
  const rules = JSON.parse(readFileSync(path.join(apiDir, "module-rules.json"), "utf8")) as ModuleRules;
  problems.push(...validateRules(rules, readCatalogue(repoRoot)).map((p) => `module-rules.json: ${p}`));

  const modulesDir = path.join(apiDir, "src/modules");
  const folders = readdirSync(modulesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const folder of folders) {
    if (!(folder in rules.modules))
      problems.push(`src/modules/${folder}: not declared in module-rules.json (use new-module)`);
  }
  for (const name of Object.keys(rules.modules)) {
    for (const required of ["index.ts", "README.md"]) {
      if (!existsSync(path.join(modulesDir, name, required)))
        problems.push(`src/modules/${name}/${required} is missing`);
    }
  }

  const registry = (await import(pathToFileURL(path.join(modulesDir, "index.ts")).href)) as {
    modules: readonly ModuleDefinition[];
  };
  const registered = new Set(registry.modules.map((m) => m.name));
  for (const name of Object.keys(rules.modules)) {
    if (!registered.has(name)) problems.push(`src/modules/index.ts: module ${name} is not registered`);
  }
  for (const name of registered) {
    if (!(name in rules.modules))
      problems.push(`src/modules/index.ts: ${name} is registered but not declared`);
  }

  const providerSdks = readProviderSdks(path.join(apiDir, "provider-sdks.json"));
  problems.push(...(await analyzeImports(apiDir, rules, providerSdks)));
  // ARC-05 FR 1 in the web app, the shared packages and tools/synthetic.
  problems.push(...(await analyzeWorkspaceSdks(repoRoot, providerSdks)).map((p) => `workspace: ${p}`));

  const snapshot = JSON.parse(
    readFileSync(path.join(apiDir, "events.snapshot.json"), "utf8"),
  ) as EventSnapshot;
  problems.push(...catalogueProblems(registry.modules, snapshot).map((p) => `events: ${p}`));
  return problems;
}
