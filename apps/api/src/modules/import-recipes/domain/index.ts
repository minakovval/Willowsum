// Domain layer of import-recipes: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export {
  checkRecipe,
  COLUMN_ROLES,
  fieldPath,
  RECIPE_DELIMITERS,
  RECIPE_ENCODINGS,
  RECIPE_LIMITS,
  RECIPE_SCHEMA_VERSION,
  recipePatterns,
  unsafeText,
} from "./recipe.ts";
export type { Recipe, RecipeCheck, RecipeError, RecipeErrorCode } from "./recipe.ts";
