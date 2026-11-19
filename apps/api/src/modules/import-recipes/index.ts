// Public interface of the import-recipes module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const importRecipesModule = defineModule({
  name: "import-recipes",
  publishes: [],
  consumes: [],
});

export { readOptionsOf, validateRecipe } from "./application/index.ts";
export {
  COLUMN_ROLES,
  RECIPE_DELIMITERS,
  RECIPE_ENCODINGS,
  RECIPE_LIMITS,
  RECIPE_SCHEMA_VERSION,
} from "./domain/index.ts";
export type { Recipe, RecipeCheck, RecipeError, RecipeErrorCode } from "./domain/index.ts";
