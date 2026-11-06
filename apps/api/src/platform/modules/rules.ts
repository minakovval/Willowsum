import type { CatalogueEntry, ModuleLayer } from "./catalogue.ts";

/**
 * apps/api/module-rules.json — the one file that declares every module and the modules it may depend on
 * (ARC-01 FR 4). The dependency analyzer (scripts/check-modules.ts) enforces it on the actual imports.
 */
export interface ModuleRules {
  readonly modules: Readonly<Record<string, ModuleRule>>;
}

export interface ModuleRule {
  readonly layer: ModuleLayer;
  /** Modules whose public interface (index.ts) this module may import. */
  readonly dependsOn: readonly string[];
}

const LAYER_RANK: Record<ModuleLayer, number> = { platform: 0, subject: 1, process: 2 };

export const MODULE_NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Problems in the rules file itself: unknown modules, missing dependencies, wrong direction, cycles. */
export function validateRules(rules: ModuleRules, catalogue: ReadonlyMap<string, CatalogueEntry>): string[] {
  const problems: string[] = [];
  const names = Object.keys(rules.modules);
  for (const name of names) {
    const rule = rules.modules[name]!;
    if (!MODULE_NAME_RE.test(name)) problems.push(`${name}: module names are kebab-case`);
    if (!catalogue.has(name)) problems.push(`${name}: not in the module catalogue of ARC-01`);
    if (!(rule.layer in LAYER_RANK)) problems.push(`${name}: unknown layer «${String(rule.layer)}»`);
    const seen = new Set<string>();
    for (const dep of rule.dependsOn) {
      if (seen.has(dep)) problems.push(`${name}: «${dep}» is listed twice`);
      seen.add(dep);
      if (dep === name) {
        problems.push(`${name}: depends on itself`);
        continue;
      }
      const target = rules.modules[dep];
      if (!target) {
        problems.push(`${name}: depends on «${dep}», which is not declared`);
        continue;
      }
      if (LAYER_RANK[target.layer] > LAYER_RANK[rule.layer]) {
        problems.push(
          `${name} (${rule.layer}) → ${dep} (${target.layer}): dependencies point towards the platform; ` +
            `the reverse direction goes only through events`,
        );
      }
    }
  }
  for (const cycle of findCycles(rules)) problems.push(`cycle: ${cycle.join(" → ")}`);
  return problems;
}

/** Every elementary cycle found by depth-first search, each reported once (rotated to its smallest name). */
export function findCycles(rules: ModuleRules): string[][] {
  const cycles = new Map<string, string[]>();
  const visit = (node: string, stack: string[]): void => {
    const at = stack.indexOf(node);
    if (at !== -1) {
      const cycle = stack.slice(at);
      const start = cycle.indexOf([...cycle].sort()[0]!);
      const rotated = [...cycle.slice(start), ...cycle.slice(0, start)];
      cycles.set(rotated.join(">"), [...rotated, rotated[0]!]);
      return;
    }
    for (const dep of rules.modules[node]?.dependsOn ?? []) visit(dep, [...stack, node]);
  };
  for (const name of Object.keys(rules.modules)) visit(name, []);
  return [...cycles.values()];
}

/** Modules in an order where every module comes after the modules it depends on. */
export function topologicalOrder(rules: ModuleRules): string[] {
  const order: string[] = [];
  const done = new Set<string>();
  const visit = (name: string, path: Set<string>): void => {
    if (done.has(name) || path.has(name)) return;
    path.add(name);
    for (const dep of [...(rules.modules[name]?.dependsOn ?? [])].sort()) visit(dep, path);
    done.add(name);
    order.push(name);
  };
  for (const name of Object.keys(rules.modules).sort()) visit(name, new Set());
  return order;
}

/** PostgreSQL schema that a module owns: its name with «-» replaced by «_» (ARC-01 FR 3). */
export function schemaName(module: string): string {
  if (!MODULE_NAME_RE.test(module)) throw new Error(`Invalid module name «${module}»`);
  return module.replaceAll("-", "_");
}

/** Database role whose privileges cover only the module's own schema. */
export function moduleRoleName(module: string): string {
  return `ws_mod_${schemaName(module)}`;
}
