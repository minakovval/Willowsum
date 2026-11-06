import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SyntheticTable } from "./define.ts";

/**
 * Finds the generators that modules register: `<modulesDir>/<module>/synthetic.ts` exporting
 * `synthetic: SyntheticTable[]`. Each table must belong to the module's own schema.
 */
export async function loadModuleGenerators(modulesDir: string): Promise<SyntheticTable[]> {
  const tables: SyntheticTable[] = [];
  const folders = readdirSync(modulesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const module of folders) {
    const file = path.join(modulesDir, module, "synthetic.ts");
    if (!existsSync(file)) continue;
    const loaded = (await import(pathToFileURL(file).href)) as { synthetic?: readonly SyntheticTable[] };
    if (!Array.isArray(loaded.synthetic)) throw new Error(`${module}/synthetic.ts must export synthetic: SyntheticTable[]`);
    const schema = module.replaceAll("-", "_");
    for (const t of loaded.synthetic) {
      if (!t.table.startsWith(`${schema}.`))
        throw new Error(`${module}/synthetic.ts: ${t.table} is not in the module's schema «${schema}»`);
      tables.push(t);
    }
  }
  return tables;
}
