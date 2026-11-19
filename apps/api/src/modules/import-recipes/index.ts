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
} from "./adapters/index.ts";

export const importRecipesModule = defineModule({
  name: "import-recipes",
  publishes: [],
  consumes: [],
  routes: importRecipesRoutes,
});

export { readOptionsOf, RECIPES_PER_SPACE, validateRecipe } from "./application/index.ts";
export { createImportRecipesServices, HAND_OFF_JOB, type ImportRecipesServices } from "./adapters/index.ts";
export {
  COLUMN_ROLES,
  RECIPE_DELIMITERS,
  RECIPE_ENCODINGS,
  RECIPE_LIMITS,
  RECIPE_SCHEMA_VERSION,
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
