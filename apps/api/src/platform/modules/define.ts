import type { EventDefinition, EventRef } from "../events/define.ts";

/**
 * What a module declares in its public interface (`src/modules/<name>/index.ts`): its name, the events it
 * publishes and the events it consumes (ARC-01 FR 2). Functions and types of the interface are exported
 * next to it.
 */
export interface ModuleDefinition {
  readonly name: string;
  readonly publishes: readonly EventDefinition[];
  readonly consumes: readonly EventRef[];
}

export function defineModule(definition: ModuleDefinition): ModuleDefinition {
  for (const event of definition.publishes) {
    if (!event.name.startsWith(`${definition.name}.`)) {
      throw new Error(`Module ${definition.name} may publish only events named «${definition.name}.…»`);
    }
  }
  return definition;
}
