import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import type { AuditLog } from "../../../audit/index.ts";
import {
  applyHandOff,
  RECIPE_ENTITY,
  type RecipeHandOff,
  type RecipesAudit,
  type RecipesDeps,
} from "../../application/index.ts";

const BRAND = Symbol("willowsum-import-recipes-services");

/** The recipes' entries in the space's own log (П-10): versions and counts — never the name or the rules. */
export function recipesAudit(audit: Pick<AuditLog, "record">): RecipesAudit {
  return {
    async record(householdId, handOff, key) {
      await audit.record(householdId, {
        actor: { kind: "user", id: handOff.actorAccountId },
        channel: "web",
        entity: { type: RECIPE_ENTITY, id: handOff.entityId },
        action: handOff.action,
        changes: handOff.changes.map((c) => ({ ...c, sensitive: false })),
        key,
      });
    },
  };
}

/** What the API process wires for the import-recipes routes (src/api.ts → `ctx.services`). */
export interface ImportRecipesServices {
  readonly [BRAND]: true;
  readonly deps: RecipesDeps;
  readonly audit: RecipesAudit;
}

export function createImportRecipesServices(options: {
  /** The space keys (household's `createSpaceKeys`): only `seal` is used. */
  readonly keys: { seal(householdId: string, field: string, plaintext: string): Promise<string> };
  readonly audit: Pick<AuditLog, "record">;
  readonly clock: { now(): number };
  readonly newId: () => string;
}): ImportRecipesServices {
  return {
    [BRAND]: true,
    deps: {
      newId: options.newId,
      now: () => new Date(options.clock.now()),
      seal: (householdId, field, plaintext) => options.keys.seal(householdId, field, plaintext),
    },
    audit: recipesAudit(options.audit),
  };
}

/** The services of an import-recipes route; without them the route answers 500. */
export function importRecipesServices(ctx: ProtectedContext): ImportRecipesServices {
  const services = ctx.services as Partial<ImportRecipesServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as ImportRecipesServices;
}

/**
 * ARC-04 FR 2: the audit entries of committed changes, right away. A failure is no failure of the request: the jobs are
 * in the queue, so the worker writes the entries (WARN `import_recipes.hand_off_deferred`, class only).
 */
export async function handOffNow(
  audit: RecipesAudit,
  householdId: string,
  handOffs: readonly RecipeHandOff[],
): Promise<void> {
  try {
    for (const handOff of handOffs) await applyHandOff(audit, householdId, handOff);
  } catch (error) {
    logEvent("import_recipes.hand_off_deferred", "warn", {
      "ws.module": "import-recipes",
      "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
    });
  }
}
