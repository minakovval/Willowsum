import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A unit test that runs static analysis over real source trees (ESLint with the root config, the dependency
 * analyzer, the module check or the scaffold generator, which runs the check) needs the budget of
 * tools/test-guards/budgets.mjs. Without it, it shares Vitest's 5 s default with ordinary unit tests and
 * fails at random in a full parallel `pnpm test` (the basis is in budgets.mjs).
 */
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const ANALYSIS =
  /\bnew ESLint\(|\banalyzeImports\(|\banalyzeWorkspaceSdks\(|\bcheckModules\(|\bscaffoldModule\(|\bcruise\(/;
const BUDGET = "STATIC_ANALYSIS_TIMEOUT_MS";
const SKIP = new Set(["node_modules", "dist", "fixtures", ".tmp", "e2e"]);

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, out);
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function workspaceTestFiles(): string[] {
  const files: string[] = [];
  for (const group of ["apps", "packages"])
    for (const name of readdirSync(path.join(repoRoot, group)))
      testFiles(path.join(repoRoot, group, name), files);
  testFiles(path.join(repoRoot, "tools/synthetic"), files);
  return files;
}

describe("unit tests that run static analysis have their own time budget", () => {
  it("every such test file uses STATIC_ANALYSIS_TIMEOUT_MS", () => {
    const analysing = workspaceTestFiles().filter((file) => ANALYSIS.test(readFileSync(file, "utf8")));
    // Fails closed: the scan must see the known ones (ESLint, the analyzer and the scaffold check).
    const names = analysing.map((file) => path.relative(repoRoot, file));
    expect(names).toEqual(
      expect.arrayContaining([
        "apps/api/scripts/lib/analyze.test.ts",
        "apps/api/scripts/lib/scaffold.test.ts",
        "apps/web/src/i18n/noHardcodedStrings.test.ts",
        "packages/domain-kernel/src/lint-rules.test.ts",
      ]),
    );
    const missing = analysing
      .filter((file) => !readFileSync(file, "utf8").includes(`vi.setConfig({ testTimeout: ${BUDGET} })`))
      .map((file) => path.relative(repoRoot, file));
    expect(missing).toEqual([]);
  });
});
