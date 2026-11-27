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
    {
      keys: ["id"],
      column: "account_value_sealed",
      select: `SELECT id, account_value_sealed FROM recipes
                WHERE household_id = $1 AND account_value_sealed IS NOT NULL AND ($2::uuid IS NULL OR id > $2::uuid)
                ORDER BY id LIMIT $3 FOR UPDATE`,
      update: "UPDATE recipes SET account_value_sealed = $3 WHERE household_id = $1 AND id = $2",
      count:
        "SELECT count(*)::text AS n FROM recipes WHERE household_id = $1 AND account_value_sealed IS NOT NULL",
      sealedFor,
    },
    {
      keys: ["recipe_id", "version"],
      column: "account_value_sealed",
      select: `SELECT recipe_id, version, account_value_sealed FROM recipe_versions
                WHERE household_id = $1 AND account_value_sealed IS NOT NULL
                  AND ($2::uuid IS NULL OR (recipe_id, version) > ($2::uuid, $3::integer))
                ORDER BY recipe_id, version LIMIT $4 FOR UPDATE`,
      update:
        "UPDATE recipe_versions SET account_value_sealed = $4 WHERE household_id = $1 AND recipe_id = $2 AND version = $3",
      count:
        "SELECT count(*)::text AS n FROM recipe_versions WHERE household_id = $1 AND account_value_sealed IS NOT NULL",
      sealedFor,
    },
  ]);
}
