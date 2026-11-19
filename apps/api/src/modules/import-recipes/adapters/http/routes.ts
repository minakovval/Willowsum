import { z } from "zod";
import { decodeCursor, encodeCursor, pageOf, pageQuery } from "../../../../platform/http/pagination.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import {
  deleteRecipe,
  RECIPE_NAME_MAX,
  RecipeCeilingError,
  RecipeNotFoundError,
  RecipeRejectedError,
  saveRecipe,
  viewRecipe,
  type SpaceTx,
  type StoredRecipe,
} from "../../application/index.ts";
import { RECIPE_LIMITS, unsafeText } from "../../domain/index.ts";
import { recipesTx } from "../db/store.ts";
import { handOffNow, importRecipesServices } from "./services.ts";

/**
 * Parsing recipes of a space (IMP-06@PoC FR 1, FR 2, FR 3, FR 7, FR 14; wave 2 row 40 part 2): save, list, read and
 * delete a recipe. The space is the session's (П-5): another space's recipe is «not found». A scoped member sees no
 * recipe (00-general «Область доступу»: imports are the Owner's; PoC has one user). Behind the release flag
 * `data.import` under the feature key of the same name; no plan limit — only the technical ceiling of 200 recipes a space
 * (NFR-15 FR 17: 422 LIMIT_REACHED, never 402). A recipe is only checked and stored here; the parse worker applies it.
 */
const MODULE = "import-recipes";
const FEATURE = "data.import";
const READ = { permission: "household.data.read", feature: FEATURE } as const;
const WRITE = { permission: "household.data.write", feature: FEATURE } as const;

const recipeParams = z.object({ recipeId: z.uuid() });

const summarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  schemaVersion: z.number().int(),
  /** The format fingerprint the recipe was made for (`fp1:` + SHA-256), if any. */
  fingerprint: z.string().nullable(),
  createdAt: z.string(),
});

const detailSchema = summarySchema.extend({
  /** The recipe (schema `schemaVersion`) without the account binding's value, which is kept sealed. */
  recipe: z.record(z.string(), z.unknown()),
  /** The account binding's value masked: its last 4 characters (NFR-01 FR 6); null without one. */
  accountValueLast4: z.string().nullable(),
});

function presentSummary(r: StoredRecipe): z.input<typeof summarySchema> {
  return {
    id: r.id,
    name: r.name,
    schemaVersion: r.schemaVersion,
    fingerprint: r.fingerprint,
    createdAt: r.createdAt.toISOString(),
  };
}

const presentDetail = (r: StoredRecipe): z.input<typeof detailSchema> => ({
  ...presentSummary(r),
  recipe: r.recipe as Record<string, unknown>,
  accountValueLast4: r.accountValueLast4,
});

/** A recipe of another space or unknown: one answer, never a hint that it exists. */
function refusal(error: unknown): unknown {
  if (error instanceof RecipeNotFoundError) return new ApiProblem("NOT_FOUND");
  if (error instanceof RecipeRejectedError)
    return new ApiProblem("RECIPE_INVALID", {
      extensions: {
        recipeErrors: error.errors.map((e) => ({
          code: e.code,
          path: e.path,
          ...(e.reason ? { reason: e.reason } : {}),
        })),
      },
    });
  if (error instanceof RecipeCeilingError)
    return new ApiProblem("LIMIT_REACHED", { extensions: { limit: error.limit } });
  return error;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw refusal(error);
  }
}

/** The route's transactions, bound to the session's space (П-5). */
const routeTx =
  (ctx: ProtectedContext): SpaceTx =>
  (work) =>
    ctx.inHousehold((q) => work(recipesTx(q)));

function owner(ctx: ProtectedContext): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

export const createImportRecipeRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/import/recipes",
  operationId: "createImportRecipe",
  summary:
    "Saves a parsing recipe (FR 1, FR 2, FR 3, FR 14): checked whole; an invalid one is 422 RECIPE_INVALID with each error's code and path",
  access: WRITE,
  create: true,
  // Above the recipe's 32 KB, so that a larger recipe is refused with its own code (AC4), not by the body limit.
  bodyLimitBytes: 2 * RECIPE_LIMITS.bytes,
  request: {
    body: z
      .object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(RECIPE_NAME_MAX)
          .refine((name) => !unsafeText(name), { message: "control characters are not allowed" }),
        /** The recipe as data (schema version 1); checked by the module, not by this schema. */
        recipe: z.unknown(),
        fingerprint: z
          .string()
          .regex(/^fp1:[0-9a-f]{64}$/)
          .nullable()
          .optional(),
      })
      .strict(),
  },
  problems: ["RECIPE_INVALID", "LIMIT_REACHED"],
  response: { status: 201, description: "The saved recipe", schema: detailSchema },
  handler: async ({ body }, ctx) => {
    owner(ctx);
    const { deps, audit } = importRecipesServices(ctx);
    const { householdId, userId } = ctx.principal;
    const { result, handOffs } = await guarded(() =>
      saveRecipe(
        deps,
        routeTx(ctx),
        { actorId: userId, householdId },
        { name: body.name, recipe: body.recipe, fingerprint: body.fingerprint ?? null },
      ),
    );
    await handOffNow(audit, householdId, handOffs);
    return presentDetail(result);
  },
});

const recipePosition = z.object({ c: z.iso.datetime(), i: z.uuid() });

export const listImportRecipesRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/recipes",
  operationId: "listImportRecipes",
  summary: "The space's parsing recipes, newest first, without their rules",
  access: READ,
  list: true,
  request: { query: pageQuery },
  response: { status: 200, description: "A page of recipes", schema: pageOf(summarySchema) },
  handler: async ({ query }, ctx) => {
    owner(ctx);
    const after = query.cursor ? decodeCursor(query.cursor, recipePosition) : null;
    const rows = await routeTx(ctx)((tx) =>
      tx.list(query.limit + 1, after ? { createdAt: new Date(after.c), id: after.i } : undefined),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(presentSummary),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ c: last.createdAt.toISOString(), i: last.id })
          : null,
    };
  },
});

export const getImportRecipeRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/recipes/{recipeId}",
  operationId: "getImportRecipe",
  summary: "A parsing recipe with its rules; the account binding's value only masked",
  access: READ,
  request: { params: recipeParams },
  response: { status: 200, description: "The recipe", schema: detailSchema },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    const recipe = await guarded(() => routeTx(ctx)((tx) => viewRecipe(tx, params.recipeId)));
    return presentDetail(recipe);
  },
});

export const deleteImportRecipeRoute = defineRoute({
  module: MODULE,
  method: "DELETE",
  path: "/v1/import/recipes/{recipeId}",
  operationId: "deleteImportRecipe",
  summary: "Deletes a parsing recipe with its sealed account value",
  access: WRITE,
  request: { params: recipeParams },
  response: { status: 200, description: "Deleted", schema: z.object({ deleted: z.literal(true) }) },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    const { deps, audit } = importRecipesServices(ctx);
    const { householdId, userId } = ctx.principal;
    const { handOffs } = await guarded(() => deleteRecipe(deps, routeTx(ctx), userId, params.recipeId));
    await handOffNow(audit, householdId, handOffs);
    return { deleted: true as const };
  },
});

export const importRecipesRoutes = [
  createImportRecipeRoute,
  listImportRecipesRoute,
  getImportRecipeRoute,
  deleteImportRecipeRoute,
];
