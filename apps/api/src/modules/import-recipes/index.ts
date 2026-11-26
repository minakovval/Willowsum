// Public interface of the import-recipes module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import {
  eraseHouseholdRecipes,
  importRecipesRoutes,
  recipesAudit,
  recipesWorkerQueue,
  requeueDeadHandOffs,
  spaceTx,
} from "./adapters/index.ts";
import { isStaleSchema, type Recipe } from "./domain/index.ts";

export const importRecipesModule = defineModule({
  name: "import-recipes",
  publishes: [],
  consumes: [],
  routes: importRecipesRoutes,
});

export {
  ACCOUNT_VALUE_FIELD,
  readOptionsOf,
  RECIPES_PER_SPACE,
  TEMPLATE_VERSIONS_KEPT,
  validateRecipe,
} from "./application/index.ts";
export { createImportRecipesServices, HAND_OFF_JOB, type ImportRecipesServices } from "./adapters/index.ts";
export {
  COLUMN_ROLES,
  RECIPE_DELIMITERS,
  RECIPE_ENCODINGS,
  RECIPE_LIMITS,
  RECIPE_SCHEMA_VERSION,
  recipeSchema,
} from "./domain/index.ts";
export type { Recipe, RecipeCheck, RecipeError, RecipeErrorCode } from "./domain/index.ts";

/** The worker's import-recipes queue (ARC-04 FR 2, FR 3; src/wiring.ts): the audit hand-off jobs. */
export function createImportRecipesWorkerQueue(
  db: ModuleDatabase,
  audit: Pick<AuditLog, "record">,
): WorkerQueue {
  return recipesWorkerQueue(db, recipesAudit(audit));
}

/** The scheduler's daily recovery of the hand-off (ARC-04 FR 4, #249): dead hand-off jobs go back to the queue. */
export function createImportRecipesHandOffRecovery(
  db: ModuleDatabase,
  households: () => Promise<readonly string[]>,
): { run(): Promise<number> } {
  return {
    async run() {
      let requeued = 0;
      for (const householdId of await households()) requeued += await requeueDeadHandOffs(db, householdId);
      return requeued;
    },
  };
}

/** Erasure of a space's recipes (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface ImportRecipesErasure {
  eraseHousehold(householdId: string): Promise<{ readonly recipes: number; readonly jobs: number }>;
}

/** `db` is the import-recipes module's own database (`ModuleDatabases.for("import-recipes")`). */
export function createImportRecipesErasure(db: ModuleDatabase): ImportRecipesErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdRecipes(db, householdId) };
}

/**
 * A space's recipe to parse a statement with (IMP-06@PoC FR 1; wave 2 row 41 part 3). The account binding's value
 * stays sealed: the caller gets an opener of `ACCOUNT_VALUE_FIELD` from household's `SpaceKeys.fieldOpener` for the
 * same space and hands both to the parse worker, the only place it is opened (#618, its second item).
 */
export interface RecipeForParse {
  readonly id: string;
  /** The recipe without `account.value`. */
  readonly recipe: Recipe;
  /** `account.value` sealed with the space's key for `ACCOUNT_VALUE_FIELD`, or null without one. */
  readonly accountValueSealed: string | null;
  /** The format fingerprint the recipe was made for (`fp1:…`), or null (IMP-06 FR 6: «збіг» / «змінився» / «невідомо»). */
  readonly fingerprint: string | null;
  /** IMP-07 FR 5: saved with an older schema version — not applied until saved again from the editor. */
  readonly stale: boolean;
}

export interface ImportRecipesReader {
  /** The space's recipe; another space's recipe, or none, is null (read in the space's transaction and row policy). */
  forParse(householdId: string, recipeId: string): Promise<RecipeForParse | null>;
  /**
   * The template to apply automatically to a file of this format (`fp1:` + SHA-256; IMP-06 FR 7, IMP-07 FR 6, FR 7):
   * of scope «рахунок» for the file's account (`accountId`) first, then of scope «простір», the most recently updated;
   * never another account's or a stale one (FR 5); a template without a fingerprint never (FR 4). Null — none; read
   * like `forParse`.
   */
  forFormat(
    householdId: string,
    fingerprint: string,
    accountId?: string | null,
  ): Promise<RecipeForParse | null>;
  /**
   * IMP-07 FR 13: the template was used by this parse — its counter and last use. The same parse again (a retried job)
   * counts once; another space's or an unknown template is left alone.
   */
  recordUse(householdId: string, recipeId: string, parseId: string, at: Date): Promise<void>;
}

const FINGERPRINT = /^fp1:[0-9a-f]{64}$/;

const forParseOf = (found: {
  readonly id: string;
  readonly recipe: Recipe;
  readonly accountValueSealed: string | null;
  readonly fingerprint: string | null;
  readonly schemaVersion: number;
}): RecipeForParse => ({
  id: found.id,
  recipe: found.recipe,
  accountValueSealed: found.accountValueSealed,
  fingerprint: found.fingerprint,
  stale: isStaleSchema(found.schemaVersion),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `db` is the import-recipes module's own database. */
export function createImportRecipesReader(db: ModuleDatabase): ImportRecipesReader {
  return {
    async forParse(householdId, recipeId) {
      if (!UUID.test(recipeId) || !UUID.test(householdId)) return null;
      const found = await spaceTx(db, householdId)((tx) => tx.find(recipeId));
      if (!found || found.householdId !== householdId) return null;
      return forParseOf(found);
    },
    async forFormat(householdId, fingerprint, accountId = null) {
      if (!FINGERPRINT.test(fingerprint) || !UUID.test(householdId)) return null;
      if (accountId !== null && !UUID.test(accountId)) return null;
      const found = await spaceTx(db, householdId)((tx) => tx.forFormat(fingerprint, accountId));
      if (!found || found.householdId !== householdId) return null;
      return forParseOf(found);
    },
    async recordUse(householdId, recipeId, parseId, at) {
      if (!UUID.test(recipeId) || !UUID.test(householdId) || !UUID.test(parseId)) return;
      await spaceTx(db, householdId)((tx) => tx.recordUse(recipeId, parseId, at));
    },
  };
}
