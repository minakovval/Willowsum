import type { ModuleDefinition } from "../modules/define.ts";
import { compatibilityProblems } from "./compat.ts";
import { eventKey, payloadJsonSchema, type JsonSchema } from "./define.ts";

/** apps/api/events.snapshot.json: the published payload schema of every event version. */
export interface EventSnapshot {
  readonly events: Readonly<Record<string, JsonSchema>>;
}

/** Current event catalogue: `<name>@v<version>` → JSON Schema of the payload. */
export function buildCatalogue(modules: readonly ModuleDefinition[]): Record<string, JsonSchema> {
  const catalogue: Record<string, JsonSchema> = {};
  for (const module of modules) {
    for (const event of module.publishes) {
      const key = eventKey(event);
      if (key in catalogue) throw new Error(`Event ${key} is published twice`);
      catalogue[key] = payloadJsonSchema(event);
    }
  }
  return catalogue;
}

/**
 * Contract check of the whole catalogue (runs in CI): published versions stay compatible with the
 * snapshot, no version disappears, and every consumed event exists in the version the consumer expects.
 */
export function catalogueProblems(modules: readonly ModuleDefinition[], snapshot: EventSnapshot): string[] {
  const problems: string[] = [];
  const catalogue = buildCatalogue(modules);
  for (const [key, published] of Object.entries(snapshot.events)) {
    const current = catalogue[key];
    if (!current) {
      problems.push(`${key}: published version removed (keep it until no consumer uses it)`);
      continue;
    }
    for (const p of compatibilityProblems(published, current)) {
      problems.push(`${key}: incompatible change ${p} — publish a new version instead`);
    }
  }
  for (const key of Object.keys(catalogue)) {
    if (!(key in snapshot.events))
      problems.push(`${key}: not in events.snapshot.json — run pnpm events:snapshot`);
  }
  for (const module of modules) {
    for (const ref of module.consumes) {
      if (!(eventKey(ref) in catalogue))
        problems.push(`${module.name} consumes ${eventKey(ref)}, which is not published`);
    }
  }
  return problems;
}

/** New snapshot: adds new versions and compatible changes; refuses incompatible ones. */
export function nextSnapshot(modules: readonly ModuleDefinition[], snapshot: EventSnapshot): EventSnapshot {
  const problems = catalogueProblems(modules, snapshot).filter(
    (p) => !p.includes("not in events.snapshot.json"),
  );
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const catalogue = buildCatalogue(modules);
  const sorted = Object.fromEntries(Object.entries(catalogue).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { events: sorted };
}
