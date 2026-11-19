import { describe, expect, it } from "vitest";
import { checkRecipe, RECIPE_LIMITS, RECIPE_SCHEMA_VERSION, recipePatterns, type Recipe } from "./index.ts";
import { FULL_RECIPE } from "./recipe.test-helper.ts";

const errorsOf = (input: unknown) => {
  const result = checkRecipe(input);
  return result.ok ? [] : result.errors;
};

describe("IMP-06@PoC: the recipe's schema", () => {
  it("IMP-06@PoC FR 1: a recipe is data with a schema version; every group of rules is accepted", () => {
    expect(RECIPE_SCHEMA_VERSION).toBe(1);
    const result = checkRecipe(FULL_RECIPE);
    expect(result).toEqual({ ok: true, recipe: FULL_RECIPE });
    expect(checkRecipe({ schemaVersion: 1 })).toEqual({ ok: true, recipe: { schemaVersion: 1 } });
  });

  it("IMP-06@PoC FR 1: each mode of sign, currency and account binding is accepted with what it needs", () => {
    const valid: unknown[] = [
      { schemaVersion: 1, sign: { mode: "auto" } },
      { schemaVersion: 1, sign: { mode: "as-printed" } },
      { schemaVersion: 1, sign: { mode: "invert" } },
      { schemaVersion: 1, currency: { mode: "auto" } },
      { schemaVersion: 1, currency: { mode: "column", column: 2 } },
      { schemaVersion: 1, currency: { mode: "file", pattern: "Валюта: ([A-Z]{3})" } },
      { schemaVersion: 1, currency: { mode: "row", pattern: "([A-Z]{3})$" } },
      { schemaVersion: 1, account: { by: "account-number", value: "00000000000001" } },
      { schemaVersion: 1, account: { by: "mask", value: "**** 1234" } },
      { schemaVersion: 1, account: { by: "header-pattern", pattern: "Рахунок: (UA\\d{27})" } },
      { schemaVersion: 1, account: { by: "column", column: 9 } },
      { schemaVersion: 1, dates: { order: "mdy" } },
    ];
    for (const recipe of valid) expect(errorsOf(recipe), JSON.stringify(recipe)).toEqual([]);
  });

  it("IMP-06@PoC AC2: a field the schema does not have is refused with «unknown field» and the field's path", () => {
    expect(errorsOf({ ...FULL_RECIPE, colour: "red" })).toEqual([{ code: "UNKNOWN_FIELD", path: "colour" }]);
    const columns = FULL_RECIPE.columns.map((c, i) => (i === 3 ? { ...c, width: 10 } : c));
    expect(errorsOf({ ...FULL_RECIPE, columns })).toEqual([
      { code: "UNKNOWN_FIELD", path: "columns[3].width" },
    ]);
  });

  it("IMP-06@PoC FR 14: an error has a code and the field's path, e.g. «columns[3].role»", () => {
    const columns = FULL_RECIPE.columns.map((c, i) => (i === 3 ? { ...c, role: "colour" } : c));
    expect(errorsOf({ ...FULL_RECIPE, columns })).toEqual([
      { code: "INVALID_VALUE", path: "columns[3].role" },
    ]);
    expect(errorsOf({ schemaVersion: 1, columns: [{ role: "date" }] })).toEqual([
      { code: "MISSING_FIELD", path: "columns[0].column" },
    ]);
    expect(errorsOf({})).toEqual([{ code: "MISSING_FIELD", path: "schemaVersion" }]);
    expect(errorsOf({ schemaVersion: 2 })).toEqual([
      { code: "UNSUPPORTED_SCHEMA_VERSION", path: "schemaVersion" },
    ]);
    expect(errorsOf([])).toEqual([{ code: "INVALID_VALUE", path: "" }]);
    expect(errorsOf({ schemaVersion: 1, file: { skipRows: -1 } })).toEqual([
      { code: "INVALID_VALUE", path: "file.skipRows" },
    ]);
  });

  it("IMP-06@PoC FR 14: a rule without what its mode needs is incomplete", () => {
    expect(errorsOf({ schemaVersion: 1, sign: { mode: "indicator", column: 2 } })).toEqual([
      { code: "INCOMPLETE_RULE", path: "sign.outValues" },
      { code: "INCOMPLETE_RULE", path: "sign.inValues" },
    ]);
    expect(errorsOf({ schemaVersion: 1, currency: { mode: "fixed" } })).toEqual([
      { code: "INCOMPLETE_RULE", path: "currency.code" },
    ]);
    expect(errorsOf({ schemaVersion: 1, account: { by: "column" } })).toEqual([
      { code: "INCOMPLETE_RULE", path: "account.column" },
    ]);
    expect(errorsOf({ schemaVersion: 1, filters: { skipStatuses: ["x"] } })).toEqual([
      { code: "INCOMPLETE_RULE", path: "filters.statusColumn" },
    ]);
  });

  it("IMP-06@PoC FR 14: two rules for one column are refused", () => {
    const columns = [
      { column: 4, role: "amount" },
      { column: 4, role: "balance" },
    ];
    expect(errorsOf({ schemaVersion: 1, columns })).toEqual([
      { code: "DUPLICATE_COLUMN_RULE", path: "columns[1].column" },
    ]);
  });

  it("IMP-06@PoC AC4: a recipe of 40 KB is refused with «recipe too large»", () => {
    expect(RECIPE_LIMITS.bytes).toBe(32 * 1024);
    const big = {
      schemaVersion: 1,
      columns: [{ column: 1, role: "description", header: "x".repeat(40 * 1024) }],
    };
    expect(errorsOf(big)).toEqual([{ code: "RECIPE_TOO_LARGE", path: "" }]);
    expect(errorsOf(JSON.stringify(big))).toEqual([{ code: "RECIPE_TOO_LARGE", path: "" }]);
    // Counted in UTF-8 bytes: 17 K Cyrillic letters (under 32 K characters) are 34 KiB.
    const cyrillic = { schemaVersion: 1, account: { by: "mask", value: "ж".repeat(17 * 1024) } };
    expect(errorsOf(cyrillic)[0]).toEqual({ code: "RECIPE_TOO_LARGE", path: "" });
  });

  it("IMP-06@PoC FR 2: at most 64 column rules", () => {
    const columns = (n: number) => Array.from({ length: n }, (_, i) => ({ column: i + 1, role: "ignore" }));
    expect(errorsOf({ schemaVersion: 1, columns: columns(64) })).toEqual([]);
    expect(errorsOf({ schemaVersion: 1, columns: columns(65) })).toEqual([
      { code: "TOO_MANY_COLUMN_RULES", path: "columns" },
    ]);
  });

  it("IMP-06@PoC FR 2: at most 20 rules with patterns, counted over the whole recipe", () => {
    const ignoreRows = (n: number) => Array.from({ length: n }, (_, i) => `^x${i}`);
    expect(
      errorsOf({ schemaVersion: 1, filters: { ignoreRows: ignoreRows(19) }, file: { footerPattern: "^y" } }),
    ).toEqual([]);
    expect(
      errorsOf({ schemaVersion: 1, filters: { ignoreRows: ignoreRows(20) }, file: { footerPattern: "^y" } }),
    ).toEqual([{ code: "TOO_MANY_PATTERNS", path: "" }]);
  });

  it("IMP-06@PoC FR 2: 21 extraction rules or 21 ignore patterns alone are «too many patterns»", () => {
    const extract = Array.from({ length: 21 }, () => ({
      column: 1,
      pattern: "a",
      group: 0,
      target: "reference",
    }));
    expect(errorsOf({ schemaVersion: 1, extract })).toEqual([{ code: "TOO_MANY_PATTERNS", path: "" }]);
    const ignoreRows = Array.from({ length: 21 }, (_, i) => `^x${i}`);
    expect(errorsOf({ schemaVersion: 1, filters: { ignoreRows } })).toEqual([
      { code: "TOO_MANY_PATTERNS", path: "" },
    ]);
  });

  it("IMP-06@PoC FR 2: unknown keys are refused at every level, and so is deep nesting or text that is not JSON", () => {
    expect(errorsOf({ schemaVersion: 1, numbers: { decimalSeparator: ",", grouping: 3 } })).toEqual([
      { code: "UNKNOWN_FIELD", path: "numbers.grouping" },
    ]);
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = { a: deep };
    expect(errorsOf({ schemaVersion: 1, x: deep })).toEqual([{ code: "RECIPE_TOO_DEEP", path: "" }]);
    expect(errorsOf(`${"[".repeat(5000)}${"]".repeat(5000)}`)).toEqual([
      { code: "RECIPE_TOO_DEEP", path: "" },
    ]);
    expect(errorsOf("{not json")).toEqual([{ code: "RECIPE_NOT_JSON", path: "" }]);
    expect(errorsOf('{"schemaVersion":1,"__proto__":{"x":1}}')).toEqual([
      { code: "UNKNOWN_FIELD", path: "__proto__" },
    ]);
  });

  it("IMP-06@PoC FR 3: the recipe's patterns are listed with their paths for the safe dialect", () => {
    const result = checkRecipe(FULL_RECIPE);
    expect(result.ok).toBe(true);
    expect(recipePatterns((result as { recipe: Recipe }).recipe)).toEqual([
      { path: "file.footerPattern", source: "^Разом" },
      { path: "filters.ignoreRows[0]", source: "^Разом" },
      { path: "filters.ignoreRows[1]", source: "^Всього" },
      { path: "extract[0].pattern", source: String.raw`Ref:\s*([A-Z0-9]{1,20})` },
    ]);
  });
});
