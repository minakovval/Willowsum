import { z } from "zod";

/**
 * A versioned event (ARC-01, «Каталог подій»). The name is `<module>.<event>` in kebab-case; the payload
 * schema of a published version may change only compatibly (see compat.ts), otherwise publish a new
 * version.
 */
export interface EventDefinition<S extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly version: number;
  readonly schema: S;
}

export interface EventRef {
  readonly name: string;
  readonly version: number;
}

const EVENT_NAME_RE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

export function defineEvent<S extends z.ZodType>(definition: EventDefinition<S>): EventDefinition<S> {
  if (!EVENT_NAME_RE.test(definition.name)) {
    throw new Error(`Event name «${definition.name}» must be <module>.<event> in kebab-case`);
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`Event ${definition.name}: version must be a positive integer`);
  }
  return definition;
}

export function eventKey(ref: EventRef): string {
  return `${ref.name}@v${ref.version}`;
}

/** JSON Schema of the payload; this is what the committed snapshot stores and compares. */
export function payloadJsonSchema(event: EventDefinition): JsonSchema {
  return z.toJSONSchema(event.schema, { target: "draft-2020-12" }) as JsonSchema;
}

export type JsonSchema = { [key: string]: unknown };
