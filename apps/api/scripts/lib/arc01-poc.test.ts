import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync, type Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modules as registry } from "../../src/modules/index.ts";
import { readCatalogue, readReleaseCatalogue } from "../../src/platform/modules/catalogue.ts";
import type { ModuleRules } from "../../src/platform/modules/rules.ts";
import { makeTestTmpDir, removeTestTmpDir } from "../../test/tmp-dir.ts";
import { STATIC_ANALYSIS_TIMEOUT_MS } from "../../../../tools/test-guards/budgets.mjs";
import { moduleImports } from "./analyze.ts";
import { checkModules } from "./check.ts";

// Static analysis of real source trees: budget and its basis in tools/test-guards/budgets.mjs.
vi.setConfig({ testTimeout: STATIC_ANALYSIS_TIMEOUT_MS });

const apiDir = fileURLToPath(new URL("../..", import.meta.url));
const repoRoot = path.resolve(apiDir, "../..");
const rules = JSON.parse(readFileSync(path.join(apiDir, "module-rules.json"), "utf8")) as ModuleRules;
const modulesDir = path.join(apiDir, "src/modules");
const folders = readdirSync(modulesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const pocCatalogue = readReleaseCatalogue(repoRoot, "poc");
const fullCatalogue = readCatalogue(repoRoot);

/**
 * Modules in code that the PoC catalogue does not list yet, though PoC slices need them: `data-erasure`
 * (NFR-12@PoC п. 3, ADR-0013; its catalogue row is tagged MVP) and `reports` (FLW-38@PoC names it; tagged MVP).
 * Moving the two catalogue rows to PoC is a requirement change for the owner (docs/decisions/log/
 * 2026-11-13-poc-module-skeletons.md); until then the list is pinned here, so any other difference fails.
 */
const PENDING_CATALOGUE_ROWS = ["data-erasure", "reports"];

describe("ARC-01@PoC FR 1: the modules of the PoC catalogue are the modules in code", () => {
  it("ARC-01@PoC FR 1: folders, module-rules.json and the registry name the same modules", () => {
    expect(Object.keys(rules.modules).sort()).toEqual(folders);
    expect(registry.map((m) => m.name).sort()).toEqual(folders);
  });

  it("ARC-01@PoC FR 1: every module of the PoC catalogue exists in code with its card and three layers", () => {
    expect(pocCatalogue.size).toBe(28);
    for (const name of pocCatalogue.keys()) {
      expect(folders, name).toContain(name);
      for (const file of ["index.ts", "README.md", "domain", "application", "adapters"])
        expect(readdirSync(path.join(modulesDir, name)), `${name}/${file}`).toContain(file);
    }
  });

  it("ARC-01@PoC FR 1: code has no module outside the PoC catalogue except the pinned catalogue rows", () => {
    const extra = folders.filter((name) => !pocCatalogue.has(name));
    expect(extra).toEqual(PENDING_CATALOGUE_ROWS);
    for (const name of extra) expect(fullCatalogue.has(name), name).toBe(true);
  });

  it("ARC-01@PoC FR 1: each module card states what the catalogue says the module owns", () => {
    for (const name of folders) {
      const card = readFileSync(path.join(modulesDir, name, "README.md"), "utf8");
      expect(card, name).toMatch(new RegExp(`^# Модуль ${name}\\n`));
      // Skeleton cards from the generator quote the catalogue; cards of built modules describe more.
      if (card.includes("Каркас без функцій"))
        expect(card, name).toContain(`${fullCatalogue.get(name)!.owns}.`);
    }
  });
});

describe("ARC-01@PoC FR 6: a module can move to its own service without changes in other modules", () => {
  let work = "";
  beforeEach(() => {
    work = makeTestTmpDir("arc01-fr6");
  });
  afterEach(() => removeTestTmpDir(work));

  it("ARC-01@PoC FR 6: other modules reach a module only through its index.ts and only when they declare it", async () => {
    const imports = await moduleImports(apiDir);
    const throughInternals = imports.filter((i) => i.to !== `src/modules/${i.toModule}/index.ts`);
    expect(throughInternals).toEqual([]);
    const undeclared = imports.filter((i) => !rules.modules[i.fromModule]?.dependsOn.includes(i.toModule));
    expect(undeclared).toEqual([]);
    // The analysis sees real cross-module imports (data-erasure uses audit, household, identity, ledger).
    expect(new Set(imports.map((i) => `${i.fromModule}→${i.toModule}`))).toContain("data-erasure→ledger");
  });

  it("ARC-01@PoC FR 6: removing every module that no other module depends on leaves the others unchanged and valid", async () => {
    const copy = path.join(work, "api");
    cpSync(path.join(apiDir, "src/platform"), path.join(copy, "src/platform"), {
      recursive: true,
      filter: (source) => !source.endsWith(".test.ts"),
    });
    cpSync(modulesDir, path.join(copy, "src/modules"), {
      recursive: true,
      filter: (source) => !source.endsWith(".test.ts"),
    });
    cpSync(path.join(apiDir, "provider-sdks.json"), path.join(copy, "provider-sdks.json"));
    cpSync(path.join(apiDir, "events.snapshot.json"), path.join(copy, "events.snapshot.json"));

    const needed = new Set(Object.values(rules.modules).flatMap((r) => r.dependsOn));
    const removed = folders.filter((name) => !needed.has(name));
    const kept = folders.filter((name) => needed.has(name));
    // Every module this PR adds is such a module: nothing depends on it yet.
    expect(removed).toEqual(expect.arrayContaining(["accounts", "transactions", "budget", "file-storage"]));
    expect(kept.length).toBeGreaterThan(0);

    const snapshotOf = (dir: string): Record<string, string> =>
      Object.fromEntries(
        kept.flatMap((name) =>
          (
            readdirSync(path.join(dir, name), {
              recursive: true,
              withFileTypes: true,
            }) as Dirent[]
          )
            .filter((d) => d.isFile() && !d.name.endsWith(".test.ts"))
            .map((d) => {
              const file = path.join(d.parentPath, d.name);
              return [path.relative(dir, file), readFileSync(file, "utf8")];
            }),
        ),
      );
    const before = snapshotOf(path.join(copy, "src/modules"));

    // Only the two registration points change: module-rules.json and the registry src/modules/index.ts.
    for (const name of removed) rmSync(path.join(copy, "src/modules", name), { recursive: true });
    writeFileSync(
      path.join(copy, "module-rules.json"),
      JSON.stringify({
        modules: Object.fromEntries(Object.entries(rules.modules).filter(([name]) => kept.includes(name))),
      }),
    );
    const registryFile = path.join(copy, "src/modules/index.ts");
    let registrySource = readFileSync(registryFile, "utf8");
    for (const name of removed) {
      const id = name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
      registrySource = registrySource
        .replace(`import { ${id}Module } from "./${name}/index.ts";\n`, "")
        .replace(`  ${id}Module,\n`, "");
    }
    writeFileSync(registryFile, registrySource);

    expect(await checkModules(copy, repoRoot)).toEqual([]);
    expect(snapshotOf(path.join(copy, "src/modules"))).toEqual(before);
  });
});
