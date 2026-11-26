import { describe, expect, it } from "vitest";
import { isStaleSchema, RECIPE_SCHEMA_VERSION, recipeSchema } from "./recipe.ts";

describe("IMP-07@PoC FR 5: a template of an older recipe schema", () => {
  it("IMP-07@PoC EC1: a template saved with an older schema version is «застарілий»; the current one is not", () => {
    expect(isStaleSchema(RECIPE_SCHEMA_VERSION - 1)).toBe(true);
    expect(isStaleSchema(RECIPE_SCHEMA_VERSION)).toBe(false);
  });

  it("Wave 2 row 49, the typed recipe: the contract's recipe marks every enum extensible (ARC-07 FR 3)", () => {
    const json = JSON.stringify(recipeSchema.toJSONSchema());
    const enums = json.match(/"enum":/g)?.length ?? 0;
    const extensible = json.match(/"x-extensible-enum":true/g)?.length ?? 0;
    expect(enums).toBeGreaterThan(10);
    expect(extensible).toBe(enums);
  });
});
