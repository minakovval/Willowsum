import { handOffKey, type RecipeHandOff } from "./recipes.ts";

/** The space's audit log as the import-recipes hand-off writes it (ADR-0015, П-10). */
export interface RecipesAudit {
  record(householdId: string, handOff: RecipeHandOff, key: string): Promise<void>;
}

/** Runs a hand-off; it can run again (the entry is keyed). Throws if the write fails, so the job is retried. */
export function applyHandOff(
  audit: RecipesAudit,
  householdId: string,
  handOff: RecipeHandOff,
): Promise<void> {
  return audit.record(householdId, handOff, handOffKey(handOff));
}
