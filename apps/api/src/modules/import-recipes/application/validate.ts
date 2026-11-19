import { checkPattern, type ReadOptions } from "../../file-parsers/index.ts";
import {
  checkRecipe,
  recipePatterns,
  type Recipe,
  type RecipeCheck,
  type RecipeError,
} from "../domain/index.ts";

/**
 * A recipe checked whole (IMP-06@PoC FR 2, FR 3, FR 14): its schema and limits (domain), then each pattern against the
 * engine's safe dialect (file-parsers' `checkPattern`; the match itself runs only in the parse worker, #607 item 3) — UNSAFE_PATTERN with the rule it breaks, INVALID_PATTERN for
 * a malformed one — and each extraction's group against the pattern's groups.
 */
export function validateRecipe(input: unknown): RecipeCheck {
  const checked = checkRecipe(input);
  if (!checked.ok) return checked;
  const errors: RecipeError[] = [];
  const groups = new Map<string, number>();
  for (const { path, source } of recipePatterns(checked.recipe)) {
    const compiled = checkPattern(source);
    if (compiled.ok) groups.set(path, compiled.groups);
    else if (compiled.issue === "syntax") errors.push({ code: "INVALID_PATTERN", path });
    else errors.push({ code: "UNSAFE_PATTERN", path, reason: compiled.issue });
  }
  checked.recipe.extract?.forEach((rule, i) => {
    const available = groups.get(`extract[${i}].pattern`);
    if (available !== undefined && rule.group > available)
      errors.push({ code: "GROUP_OUT_OF_RANGE", path: `extract[${i}].group` });
  });
  return errors.length > 0 ? { ok: false, errors } : checked;
}

/** The recipe's file rules as file-parsers reads them (rows from 0; «auto» — detected). */
export function readOptionsOf(recipe: Recipe): ReadOptions {
  const file = recipe.file ?? {};
  return {
    ...(file.encoding && file.encoding !== "auto" ? { encoding: file.encoding } : {}),
    ...(file.delimiter && file.delimiter !== "auto" ? { delimiter: file.delimiter } : {}),
    ...(file.quote ? { quote: file.quote === "none" ? null : file.quote } : {}),
    ...(file.skipRows !== undefined ? { skipRows: file.skipRows } : {}),
    ...(file.headerRow ? { headerRow: file.headerRow - 1 } : {}),
  };
}
