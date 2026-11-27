import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import { sealedColumnsPart, type ResealPart } from "../../../../platform/modules/reseal.ts";
import { ACCOUNT_VALUE_FIELD } from "../../application/index.ts";

/**
 * NFR-01@PoC FR 3: the sealed account binding values of the space's templates and of their kept versions
 * (`account_value_sealed`, field `importRecipes.accountValue`), sealed again with the space's new data key by the
 * data-key rotation. Nothing else of a template changes (no new version, no use counted).
 */
export function importRecipesResealPart(db: ModuleDatabase): ResealPart {
  const sealedFor = { kind: "field", field: ACCOUNT_VALUE_FIELD } as const;
  return sealedColumnsPart("import-recipes", db, [
    { table: "recipes", keys: ["id"], column: "account_value_sealed", sealedFor },
    { table: "recipe_versions", keys: ["recipe_id", "version"], column: "account_value_sealed", sealedFor },
  ]);
}
