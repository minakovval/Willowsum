import type { EventDefinition, EventRef } from "../events/define.ts";
import type { ApiRoute } from "../http/route.ts";

/**
 * What a module declares in its public interface (`src/modules/<name>/index.ts`): its name, the events it
 * publishes and the events it consumes (ARC-01 FR 2). Functions and types of the interface are exported
 * next to it.
 */
export interface ModuleDefinition {
  readonly name: string;
  readonly publishes: readonly EventDefinition[];
  readonly consumes: readonly EventRef[];
  /** The module's HTTP API routes under /v1 (ARC-07), declared with `defineRoute`. */
  readonly routes?: readonly ApiRoute[];
}

export function defineModule(definition: ModuleDefinition): ModuleDefinition {
  for (const event of definition.publishes) {
    if (!event.name.startsWith(`${definition.name}.`)) {
      throw new Error(`Module ${definition.name} may publish only events named «${definition.name}.…»`);
    }
  }
  for (const route of definition.routes ?? []) {
    if (route.module !== definition.name) {
      throw new Error(
        `Module ${definition.name}: route ${route.method} ${route.path} must name module «${definition.name}»`,
      );
    }
  }
  return definition;
}
