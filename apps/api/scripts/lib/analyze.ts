import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { cruise, type IViolation } from "dependency-cruiser";
import type { ModuleRules } from "../../src/platform/modules/rules.ts";
import { buildForbiddenRules, buildWorkspaceSdkRule } from "./dependency-rules.ts";
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
        doNotFollow: { path: "(^|/)node_modules/" },
        // Fixtures hold deliberate violations; test/.tmp holds copies other tests are writing.
        exclude: { path: ["^test/fixtures/", "^test/\\.tmp/"] },
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

/** Folders of the other workspace packages checked for provider SDKs (relative to the repository root). */
export function workspaceSourceDirs(repoRoot: string): string[] {
  const dirs: string[] = [];
  for (const group of ["apps", "packages"]) {
    const groupDir = path.join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir).sort()) {
      if (group === "apps" && name === "api") continue; // analyzed with all module rules by analyzeImports
      for (const sub of ["src", "e2e"])
        if (existsSync(path.join(groupDir, name, sub))) dirs.push(`${group}/${name}/${sub}`);
    }
  }
  if (existsSync(path.join(repoRoot, "tools/synthetic/src"))) dirs.push("tools/synthetic/src");
  return dirs;
}

/**
 * ARC-05 FR 1 outside apps/api: the same provider SDK rule over the web app, the shared packages and
 * tools/synthetic (dynamic `import()`, `require`, re-exports and every file kind included). The only adapter
 * location there is apps/web/src/adapters/.
 */
export async function analyzeWorkspaceSdks(
  repoRoot: string,
  providerSdks: ProviderSdkList,
  dirs: readonly string[] = workspaceSourceDirs(repoRoot),
): Promise<string[]> {
  if (dirs.length === 0 || providerSdks.packages.length === 0) return [];
  const previous = process.cwd();
  process.chdir(repoRoot);
  try {
    const result = await cruise(
      [...dirs],
      {
        baseDir: repoRoot,
        validate: true,
        ruleSet: { forbidden: [buildWorkspaceSdkRule(providerSdks)] },
        tsPreCompilationDeps: true,
        doNotFollow: { path: "(^|/)node_modules/" },
        exclude: { path: ["(^|/)node_modules/", "^(apps|packages|tools)/[^/]+/dist/"] },
        outputType: "json",
      },
      {
        extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json"],
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
