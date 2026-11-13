import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCatalogue } from "../../src/platform/modules/catalogue.ts";
import { readMigrations } from "../../src/platform/db/migrate.ts";
import { checkModules } from "./check.ts";
import { scaffoldModule } from "./scaffold.ts";
import { makeTestTmpDir, removeTestTmpDir } from "../../test/tmp-dir.ts";

const apiDir = fileURLToPath(new URL("../..", import.meta.url));
const repoRoot = path.resolve(apiDir, "../..");
const catalogue = readCatalogue(repoRoot);
// Each test works in a folder of its own: integration tests write into test/.tmp at the same time.
let work = "";

function copyOfApi(): string {
  const dir = path.join(work, `api-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  cpSync(path.join(apiDir, "src/platform"), path.join(dir, "src/platform"), {
    recursive: true,
    filter: (source) => !source.endsWith(".test.ts"),
  });
  mkdirSync(path.join(dir, "src/modules"));
  // The registry as it is before any module exists (the real one lists the repository's modules).
  writeFileSync(
    path.join(dir, "src/modules/index.ts"),
    readFileSync(path.join(apiDir, "src/modules/index.ts"), "utf8")
      .replace(/^import \{ \w+ \} from "\.\/[a-z0-9-]+\/index\.ts";\n/gm, "")
      .replace(/^ {2}\w+Module,\n/gm, ""),
  );
  writeFileSync(path.join(dir, "module-rules.json"), JSON.stringify({ modules: {} }));
  writeFileSync(path.join(dir, "events.snapshot.json"), JSON.stringify({ events: {} }));
  cpSync(path.join(apiDir, "provider-sdks.json"), path.join(dir, "provider-sdks.json"));
  return dir;
}

beforeEach(() => {
  work = makeTestTmpDir("scaffold");
});
afterEach(() => removeTestTmpDir(work));

describe("ARC-01: a new module is created by the scaffold generator with one command", () => {
  it("creates three layers, the card, migrations, a test template and registers the module", async () => {
    const dir = copyOfApi();
    const created = scaffoldModule({ apiDir: dir, name: "identity", dependsOn: [], catalogue });
    scaffoldModule({ apiDir: dir, name: "ledger", dependsOn: ["identity"], catalogue });
    expect(created.sort()).toEqual([
      "src/modules/identity/README.md",
      "src/modules/identity/adapters/db/migrations/.gitkeep",
      "src/modules/identity/adapters/index.ts",
      "src/modules/identity/application/index.ts",
      "src/modules/identity/domain/index.ts",
      "src/modules/identity/index.test.ts",
      "src/modules/identity/index.ts",
    ]);
    const rules = JSON.parse(readFileSync(path.join(dir, "module-rules.json"), "utf8"));
    expect(rules.modules).toEqual({
      identity: { layer: "platform", dependsOn: [] },
      ledger: { layer: "subject", dependsOn: ["identity"] },
    });
    const card = readFileSync(path.join(dir, "src/modules/ledger/README.md"), "utf8");
    expect(card).toMatch(/\*\*Створено:\*\* \d{4}-\d{2}-\d{2} · \*\*Оновлено:\*\* \d{4}-\d{2}-\d{2}/);
    expect(card).toContain("Бухгалтерський журнал");
    expect(card).toContain("Схема `ledger`");
    // The generated module passes every check, including the dependency analyzer.
    expect(await checkModules(dir, repoRoot)).toEqual([]);
    expect(
      readMigrations({ modules: ["identity", "ledger"], modulesDir: path.join(dir, "src/modules") }),
    ).toEqual([]);
  });

  it("refuses names outside the catalogue, duplicates and rule violations", () => {
    const dir = copyOfApi();
    expect(() => scaffoldModule({ apiDir: dir, name: "misc", dependsOn: [], catalogue })).toThrow(
      /not in the module catalogue/,
    );
    scaffoldModule({ apiDir: dir, name: "budget", dependsOn: [], catalogue });
    expect(() => scaffoldModule({ apiDir: dir, name: "budget", dependsOn: [], catalogue })).toThrow(
      /already exists/,
    );
    expect(() => scaffoldModule({ apiDir: dir, name: "ledger", dependsOn: ["budget"], catalogue })).toThrow(
      /ledger \(subject\) → budget \(process\)/,
    );
    expect(() => scaffoldModule({ apiDir: dir, name: "accounts", dependsOn: ["ghost"], catalogue })).toThrow(
      /not declared/,
    );
  });

  it("the check stops undeclared folders and imports that bypass the rules", async () => {
    const dir = copyOfApi();
    scaffoldModule({ apiDir: dir, name: "identity", dependsOn: [], catalogue });
    scaffoldModule({ apiDir: dir, name: "ledger", dependsOn: [], catalogue });
    writeFileSync(
      path.join(dir, "src/modules/ledger/application/index.ts"),
      'import { identityModule } from "../../identity/index.ts";\nexport const x = identityModule;\n',
    );
    mkdirSync(path.join(dir, "src/modules/accounts"));
    const problems = await checkModules(dir, repoRoot);
    expect(problems).toEqual([
      "src/modules/accounts: not declared in module-rules.json (use new-module)",
      "undeclared-dependency:ledger: src/modules/ledger/application/index.ts → src/modules/identity/index.ts",
    ]);
  });
});

describe("ARC-03 FR 4: migration files", () => {
  it("must be numbered 0001, 0002, … without gaps", () => {
    const dir = path.join(work, "mig");
    mkdirSync(path.join(dir, "ledger/adapters/db/migrations"), { recursive: true });
    writeFileSync(path.join(dir, "ledger/adapters/db/migrations/0001_init.sql"), "SELECT 1;");
    writeFileSync(path.join(dir, "ledger/adapters/db/migrations/0003_more.sql"), "SELECT 1;");
    expect(() => readMigrations({ modules: ["ledger"], modulesDir: dir })).toThrow(/without gaps/);
    writeFileSync(path.join(dir, "ledger/adapters/db/migrations/0003_more.sql"), "");
    rmSync(path.join(dir, "ledger/adapters/db/migrations/0003_more.sql"));
    writeFileSync(path.join(dir, "ledger/adapters/db/migrations/0002-Bad.sql"), "SELECT 1;");
    expect(() => readMigrations({ modules: ["ledger"], modulesDir: dir })).toThrow(/NNNN_slug.sql/);
  });
});
