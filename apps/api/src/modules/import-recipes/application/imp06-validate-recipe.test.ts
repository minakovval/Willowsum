import { describe, expect, it } from "vitest";
import { DELIMITERS, ENCODINGS } from "../../file-parsers/index.ts";
import { FULL_RECIPE } from "../domain/recipe.test-helper.ts";
import { RECIPE_DELIMITERS, RECIPE_ENCODINGS } from "../domain/index.ts";
import { readOptionsOf, validateRecipe } from "./index.ts";

const withPattern = (source: string) => ({ schemaVersion: 1, filters: { ignoreRows: ["^Разом", source] } });

describe("IMP-06@PoC: checking a recipe with its patterns", () => {
  it("IMP-06@PoC AC3: a pattern with a back-reference is refused with «unsafe pattern»", () => {
    expect(validateRecipe(withPattern(String.raw`(\d)\1`))).toEqual({
      ok: false,
      errors: [{ code: "UNSAFE_PATTERN", path: "filters.ignoreRows[1]", reason: "backreference" }],
    });
  });

  it("IMP-06@PoC FR 3: every rule of the dialect refuses the pattern with its reason and path", () => {
    const cases: [string, string][] = [
      ["a(?=b)", "lookaround"],
      [String.raw`\p{L}`, "unicode-class"],
      ["a+b+c+d+", "too-many-unbounded"],
      ["(a+)+", "nested-repeat"],
      ["a{1,500}", "repeat-bound"],
      ["a".repeat(201), "too-long"],
    ];
    for (const [source, reason] of cases)
      expect(validateRecipe(withPattern(source))).toEqual({
        ok: false,
        errors: [{ code: "UNSAFE_PATTERN", path: "filters.ignoreRows[1]", reason }],
      });
    expect(validateRecipe(withPattern("(abc"))).toEqual({
      ok: false,
      errors: [{ code: "INVALID_PATTERN", path: "filters.ignoreRows[1]" }],
    });
  });

  it("IMP-06@PoC FR 14: an extraction group the pattern does not have is refused at its path", () => {
    const recipe = {
      schemaVersion: 1,
      extract: [{ column: 2, pattern: "Ref (\\d{1,9})", group: 2, target: "reference" }],
    };
    expect(validateRecipe(recipe)).toEqual({
      ok: false,
      errors: [{ code: "GROUP_OUT_OF_RANGE", path: "extract[0].group" }],
    });
  });

  it("IMP-06@PoC FR 1: a valid recipe passes, and its file rules become the reading's options (rows and columns from 1)", () => {
    const result = validateRecipe(FULL_RECIPE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readOptionsOf(result.recipe)).toEqual({
      encoding: "windows-1251",
      delimiter: ";",
      quote: '"',
      skipRows: 2,
      headerRow: 2,
    });
    expect(
      readOptionsOf({ schemaVersion: 1, file: { encoding: "auto", delimiter: "auto", quote: "none" } }),
    ).toEqual({
      quote: null,
    });
  });

  it("IMP-06@PoC FR 1: the recipe's encodings and delimiters are the ones the engine reads", () => {
    expect(RECIPE_ENCODINGS.filter((e) => e !== "auto")).toEqual([...ENCODINGS]);
    expect(RECIPE_DELIMITERS.filter((d) => d !== "auto")).toEqual([...DELIMITERS]);
  });
});
