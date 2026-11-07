import { existsSync } from "node:fs";
import path from "node:path";
import { cruise, type IViolation } from "dependency-cruiser";
import type { ModuleRules } from "../../src/platform/modules/rules.ts";
import { buildForbiddenRules } from "./dependency-rules.ts";
import type { ProviderSdkList } from "./provider-sdks.ts";

/**
 * Runs the dependency analyzer on `<baseDir>/src` (and `scripts/`, `test/` when present) and returns readable
 * violations. `providerSdks` adds the ARC-05 rule: provider SDKs only inside adapters.
 */
export async function analyzeImports(
  baseDir: string,
  rules: ModuleRules,
  providerSdks?: ProviderSdkList,
): Promise<string[]> {
  const previous = process.cwd();
  process.chdir(baseDir);
  try {
    const result = await cruise(
      ["src", "scripts", "test"].filter((dir) => existsSync(path.join(baseDir, dir))),
      {
        baseDir,
        validate: true,
        ruleSet: { forbidden: buildForbiddenRules(rules, providerSdks) },
        // Type-only imports count too: a type import of another module's internals is still coupling.
        tsPreCompilationDeps: true,
        doNotFollow: { path: "node_modules" },
        // Fixtures hold deliberate violations; test/.tmp holds copies other tests are writing.
        exclude: { path: ["(^|/)test/fixtures/", "(^|/)test/\\.tmp/"] },
        outputType: "json",
      },
      // Resolve like Node ESM: workspace packages export TypeScript sources through "exports".
      {
        extensions: [".ts", ".js", ".mjs", ".json"],
        conditionNames: ["import", "default"],
        exportsFields: ["exports"],
      },
    );
    const output = typeof result.output === "string" ? JSON.parse(result.output) : result.output;
    const violations = (output.summary.violations ?? []) as IViolation[];
    return violations.map((v) => `${v.rule.name}: ${v.from} → ${v.to}`).sort();
  } finally {
    process.chdir(previous);
  }
}
