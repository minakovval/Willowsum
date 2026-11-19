import { describe, expect, it } from "vitest";
import { checkRecipe, unsafeText } from "./index.ts";
import { FULL_RECIPE } from "./recipe.test-helper.ts";

// #607 item 5: the texts of a recipe are stored (row 40 part 2), so U+0000 and the other control characters are refused
// with the field's path before they reach the database; the tab of `file.delimiter` is a value of its list.
// Built from code points: a formatter may write the escapes back as the invisible characters themselves.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

describe("IMP-06@PoC FR 14: control characters in a recipe's texts", () => {
  it("IMP-06@PoC FR 14: U+0000, C0 and C1 controls, line separators and lone surrogates are refused with the path", () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["\u0000", { sign: { ...FULL_RECIPE.sign, outValues: ["Деб\u0000ет"] } }, "sign.outValues[0]"],
      ["U+001B", { columns: [{ column: 1, role: "date", header: "Дата\u001b[2J" }] }, "columns[0].header"],
      [
        "U+0085",
        { filters: { skipStatuses: ["Скасовано\u0085"], statusColumn: 8 } },
        "filters.skipStatuses[0]",
      ],
      ["U+2028", { file: { sheet: `Вип${LINE_SEPARATOR}иска` } }, "file.sheet"],
      ["U+007F", { numbers: { currencySymbols: { "\u007f$": "USD" } } }, "numbers.currencySymbols"],
      ["lone surrogate", { account: { by: "mask", value: "****\ud800" } }, "account.value"],
      ["tab in a pattern", { filters: { ignoreRows: ["^Разом\t"] } }, "filters.ignoreRows[0]"],
    ];
    for (const [label, part, path] of cases)
      expect(checkRecipe({ schemaVersion: 1, ...part }), label).toEqual({
        ok: false,
        errors: [{ code: "INVALID_CHARACTER", path }],
      });
  });

  it("IMP-06@PoC FR 14: the tab delimiter, Cyrillic, symbols and escaped patterns are not control characters", () => {
    expect(checkRecipe({ ...FULL_RECIPE, file: { ...FULL_RECIPE.file, delimiter: "\t" } }).ok).toBe(true);
    expect(checkRecipe({ schemaVersion: 1, filters: { ignoreRows: [String.raw`^Разом\t`] } }).ok).toBe(true);
    for (const text of ["Дебет", "₴", "😀 emoji", "Ref:\\s*", "Ґанок і Їжак"])
      expect(unsafeText(text)).toBe(false);
    for (const text of ["\u0000", "a\nb", "\r", "\u009f", PARAGRAPH_SEPARATOR, "\udfff"])
      expect(unsafeText(text)).toBe(true);
  });

  it("IMP-06@PoC FR 14: every refused text is listed, with the other errors of the recipe", () => {
    const check = checkRecipe({
      schemaVersion: 1,
      columns: [
        { column: 1, role: "date", header: "a\u0000" },
        { column: 1, role: "amount", header: "b\u0001" },
      ],
    });
    expect(check).toEqual({
      ok: false,
      errors: [
        { code: "INVALID_CHARACTER", path: "columns[0].header" },
        { code: "INVALID_CHARACTER", path: "columns[1].header" },
        { code: "DUPLICATE_COLUMN_RULE", path: "columns[1].column" },
      ],
    });
  });
});
