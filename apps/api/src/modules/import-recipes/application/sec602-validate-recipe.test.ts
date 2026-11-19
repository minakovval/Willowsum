import { describe, expect, it } from "vitest";
import { validateRecipe } from "./index.ts";

/** Security review of PR #602: every pattern of a recipe meets the dialect, every level refuses unknown keys. */
describe("IMP-06@PoC FR 2, FR 3: the recipe check leaves no pattern and no level out (security review)", () => {
  const errorsOf = (recipe: object) => {
    const checked = validateRecipe({ schemaVersion: 1, ...recipe });
    return checked.ok ? [] : checked.errors;
  };

  it("IMP-06@PoC FR 3: the patterns of the footer, the currency, the account, the filters and the extraction are all checked", () => {
    const unsafe = String.raw`(a)\1`;
    const reason = "backreference";
    expect(errorsOf({ file: { footerPattern: unsafe } })).toEqual([
      { code: "UNSAFE_PATTERN", path: "file.footerPattern", reason },
    ]);
    expect(errorsOf({ currency: { mode: "file", pattern: unsafe } })).toEqual([
      { code: "UNSAFE_PATTERN", path: "currency.pattern", reason },
    ]);
    expect(errorsOf({ account: { by: "header-pattern", pattern: unsafe } })).toEqual([
      { code: "UNSAFE_PATTERN", path: "account.pattern", reason },
    ]);
    expect(errorsOf({ filters: { ignoreRows: [unsafe] } })).toEqual([
      { code: "UNSAFE_PATTERN", path: "filters.ignoreRows[0]", reason },
    ]);
    expect(errorsOf({ extract: [{ column: 1, pattern: unsafe, group: 0, target: "reference" }] })).toEqual([
      { code: "UNSAFE_PATTERN", path: "extract[0].pattern", reason },
    ]);
  });

  it("IMP-06@PoC FR 2: an unknown key is refused in every group of rules", () => {
    const levels: [object, string][] = [
      [{ file: { x: 1 } }, "file.x"],
      [{ columns: [{ column: 1, role: "date", x: 1 }] }, "columns[0].x"],
      [{ dates: { x: 1 } }, "dates.x"],
      [{ numbers: { x: 1 } }, "numbers.x"],
      [{ sign: { mode: "auto", x: 1 } }, "sign.x"],
      [{ currency: { mode: "auto", x: 1 } }, "currency.x"],
      [{ account: { by: "column", column: 1, x: 1 } }, "account.x"],
      [{ filters: { x: 1 } }, "filters.x"],
      [{ extract: [{ column: 1, pattern: "a", group: 0, target: "reference", x: 1 }] }, "extract[0].x"],
    ];
    for (const [recipe, path] of levels) expect(errorsOf(recipe)).toEqual([{ code: "UNKNOWN_FIELD", path }]);
  });

  // Defect at 652ddc57 (see sec602-safe-pattern.test.ts): passes with the program bound (fixed in review round 1; was `it.fails`).
  it("IMP-06@PoC FR 3: a pattern whose expanded program is too large is refused as unsafe", () => {
    expect(errorsOf({ filters: { ignoreRows: [`(?:${"()".repeat(93)}){100}b`] } })).toEqual([
      { code: "UNSAFE_PATTERN", path: "filters.ignoreRows[0]", reason: "too-complex" },
    ]);
  });
});
