import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultLayer, type CatalogueEntry, type ModuleLayer } from "../../src/platform/modules/catalogue.ts";
import { schemaName, validateRules, type ModuleRules } from "../../src/platform/modules/rules.ts";

export interface ScaffoldOptions {
  /** apps/api folder (or a copy of it in a test). */
  readonly apiDir: string;
  readonly name: string;
  readonly dependsOn: readonly string[];
  readonly layer?: ModuleLayer;
  readonly catalogue: ReadonlyMap<string, CatalogueEntry>;
}

const camel = (name: string): string => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * Creates a module with one command (ARC-01, «Новий модуль створюється генератором каркаса»): three
 * layers, the public interface, the module card, a migrations folder, test templates; registers the
 * module in module-rules.json and in src/modules/index.ts. Returns the created files.
 */
export function scaffoldModule(options: ScaffoldOptions): string[] {
  const { apiDir, name, catalogue } = options;
  const entry = catalogue.get(name);
  if (!entry)
    throw new Error(`«${name}» is not in the module catalogue of ARC-01; add it to the requirement first`);
  const moduleDir = path.join(apiDir, "src/modules", name);
  if (existsSync(moduleDir)) throw new Error(`Module «${name}» already exists`);

  const rulesFile = path.join(apiDir, "module-rules.json");
  const rulesJson = JSON.parse(readFileSync(rulesFile, "utf8")) as ModuleRules & { $comment?: string };
  const layer = options.layer ?? defaultLayer(entry);
  const modules = { ...rulesJson.modules, [name]: { layer, dependsOn: [...options.dependsOn].sort() } };
  const nextRules: ModuleRules & { $comment?: string } = {
    ...rulesJson,
    modules: Object.fromEntries(Object.entries(modules).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  const problems = validateRules(nextRules, catalogue);
  if (problems.length > 0) throw new Error(problems.join("\n"));

  const id = camel(name);
  const files: Record<string, string> = {
    "index.ts": `// Public interface of the ${name} module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const ${id}Module = defineModule({
  name: "${name}",
  publishes: [],
  consumes: [],
});
`,
    "index.test.ts": `import { describe, expect, it } from "vitest";
import { ${id}Module } from "./index.ts";

describe("${name} module", () => {
  it("declares its public interface", () => {
    expect(${id}Module.name).toBe("${name}");
  });
});
`,
    "domain/index.ts": `// Domain layer of ${name}: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export {};
`,
    "application/index.ts": `// Application layer of ${name}: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export {};
`,
    "adapters/index.ts": `// Adapters of ${name}: database (ModuleDatabase, schema «${schemaName(name)}»), HTTP, external services.
export {};
`,
    "adapters/db/migrations/.gitkeep": "",
    "README.md": `# Модуль ${name}

**Створено:** ${today()} · **Оновлено:** ${today()}

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

${entry.owns}.

## Вимоги

—

## Публічний інтерфейс

\`index.ts\`: \`${id}Module\`.

## Залежності

Шар: ${layer}. Модулі: ${options.dependsOn.length > 0 ? options.dependsOn.join(", ") : "—"} (\`apps/api/module-rules.json\`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема \`${schemaName(name)}\`; міграції — \`adapters/db/migrations/NNNN_slug.sql\`.
`,
  };

  const created: string[] = [];
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(moduleDir, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    created.push(path.relative(apiDir, file));
  }
  writeFileSync(rulesFile, `${JSON.stringify(nextRules, null, 2)}\n`);

  const registryFile = path.join(apiDir, "src/modules/index.ts");
  const registry = readFileSync(registryFile, "utf8");
  const marker = "  // new-module: insert above this line";
  if (!registry.includes(marker)) throw new Error("src/modules/index.ts lost its insertion marker");
  const importLine = `import { ${id}Module } from "./${name}/index.ts";\n`;
  const withImport = registry.replace(/(import type [^\n]+\n)/, `$1${importLine}`);
  writeFileSync(registryFile, withImport.replace(marker, `  ${id}Module,\n${marker}`));
  return created;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
