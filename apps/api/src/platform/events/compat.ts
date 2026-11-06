import type { JsonSchema } from "./define.ts";

/**
 * Is `next` a compatible change of the published event schema `previous`? (ARC-01, «Каталог подій».)
 *
 * Compatible means every payload valid under `previous` is still valid under `next` and every consumer
 * written for `previous` still finds what it reads: for objects, existing properties keep a compatible
 * schema and keep their required/optional status (required → optional breaks consumers, optional →
 * required rejects earlier payloads); new properties must be optional; additionalProperties must not
 * become stricter. Any other change to a non-object schema must leave it identical.
 */
export function compatibilityProblems(previous: JsonSchema, next: JsonSchema, at = "$"): string[] {
  if (previous["type"] === "object" && next["type"] === "object") {
    const problems: string[] = [];
    const prevProps = (previous["properties"] ?? {}) as Record<string, JsonSchema>;
    const nextProps = (next["properties"] ?? {}) as Record<string, JsonSchema>;
    const prevRequired = new Set((previous["required"] ?? []) as string[]);
    const nextRequired = new Set((next["required"] ?? []) as string[]);
    for (const [key, schema] of Object.entries(prevProps)) {
      const nextSchema = nextProps[key];
      if (!nextSchema) {
        problems.push(`${at}.${key}: property removed`);
        continue;
      }
      if (prevRequired.has(key) && !nextRequired.has(key)) problems.push(`${at}.${key}: no longer required`);
      if (!prevRequired.has(key) && nextRequired.has(key))
        problems.push(`${at}.${key}: optional property became required`);
      problems.push(...compatibilityProblems(schema, nextSchema, `${at}.${key}`));
    }
    for (const key of Object.keys(nextProps)) {
      if (!(key in prevProps) && nextRequired.has(key))
        problems.push(`${at}.${key}: new property is required`);
    }
    if (previous["additionalProperties"] !== false && next["additionalProperties"] === false) {
      problems.push(`${at}: additional properties are no longer allowed`);
    }
    const restPrev = withoutObjectKeys(previous);
    const restNext = withoutObjectKeys(next);
    if (stableStringify(restPrev) !== stableStringify(restNext)) problems.push(`${at}: schema changed`);
    return problems;
  }
  return stableStringify(previous) === stableStringify(next) ? [] : [`${at}: schema changed`];
}

function withoutObjectKeys(schema: JsonSchema): JsonSchema {
  const rest: JsonSchema = { ...schema };
  delete rest["properties"];
  delete rest["required"];
  delete rest["additionalProperties"];
  return rest;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
