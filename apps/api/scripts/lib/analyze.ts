import { cruise, type IViolation } from "dependency-cruiser";
import type { ModuleRules } from "../../src/platform/modules/rules.ts";
import { buildForbiddenRules } from "./dependency-rules.ts";

/** Runs the dependency analyzer on `<baseDir>/src` and returns readable violations. */
export async function analyzeImports(baseDir: string, rules: ModuleRules): Promise<string[]> {
  const previous = process.cwd();
  process.chdir(baseDir);
  try {
    const result = await cruise(
      ["src"],
      {
        baseDir,
        validate: true,
        ruleSet: { forbidden: buildForbiddenRules(rules) },
        // Type-only imports count too: a type import of another module's internals is still coupling.
        tsPreCompilationDeps: true,
        doNotFollow: { path: "node_modules" },
        exclude: { path: "(^|/)test/fixtures/" },
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
