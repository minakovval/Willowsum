import { z } from "zod";
import { decodeCursor, encodeCursor, pageOf, pageQuery } from "../../../../platform/http/pagination.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import {
  accountValueLast4,
  deleteRecipe,
  RECIPE_NAME_MAX,
  RecipeCeilingError,
  RecipeNotFoundError,
  RecipeRejectedError,
  restoreTemplateVersion,
  saveRecipe,
  scopeOf,
  TemplateAccountClosedError,
  TemplateAccountNotFoundError,
  TemplateChangedError,
  TemplateNameTakenError,
  templateVersions,
  TemplateVersionNotFoundError,
  updateTemplate,
  viewRecipe,
  type SpaceTx,
  type StoredRecipe,
  type StoredVersion,
} from "../../application/index.ts";
import { isStaleSchema, RECIPE_LIMITS, recipeSchema, unsafeText } from "../../domain/index.ts";
import { recipesTx } from "../db/store.ts";
import { handOffNow, importRecipesServices } from "./services.ts";

/**
 * Parsing recipes of a space (IMP-06@PoC FR 1, FR 2, FR 3, FR 7, FR 14; wave 2 row 40 part 2): save, list, read and
 * delete a recipe. The space is the session's (П-5): another space's recipe is «not found». A scoped member sees no
 * recipe (00-general «Область доступу»: imports are the Owner's; PoC has one user). Behind the release flag
 * `data.import` under the feature key of the same name; no plan limit — only the ceiling of 100 templates a space
 * (IMP-07 FR 2, `RECIPES_PER_SPACE`; 422 LIMIT_REACHED, never 402). A recipe is only checked and stored here; the parse worker applies it.
 */
const MODULE = "import-recipes";
const FEATURE = "data.import";
const READ = { permission: "household.data.read", feature: FEATURE } as const;
const WRITE = { permission: "household.data.write", feature: FEATURE } as const;

const recipeParams = z.object({ recipeId: z.uuid() });

/**
 * The typed recipe of the contract (IMP-07, row 49; IMP-06 FR 1): the module's schema with `schemaVersion` as any
 * version (a stale template keeps an older one, FR 5) and every enum extensible (ARC-07 FR 3).
 */
const contractRecipe = recipeSchema.extend({
  schemaVersion: z.number().int().min(1).meta({ description: "The version of the recipe's schema" }),
});
/** As the server returns it: the account binding's value is never in it (kept sealed, NFR-01 FR 6). */
const returnedRecipe = contractRecipe
  .extend({ account: recipeSchema.shape.account.unwrap().omit({ value: true }).optional() })
  .meta({ description: "The recipe without the account binding's value (see accountValueLast4)" });

/**
 * The request's recipe is checked by the module, not by the request schema, so that each error has its code and path
 * (IMP-06 FR 14: 422 RECIPE_INVALID). The contract still describes it: a recipe, or the same as JSON text; the
 * client's type of a recipe to send is the response's `recipe` with `account.value`.
 */
const requestRecipe = z.unknown().meta({
  description:
    "The recipe (schema version 1) or its JSON text; checked by the module: an invalid one is 422 RECIPE_INVALID with recipeErrors",
  anyOf: [
    z.toJSONSchema(contractRecipe, { target: "draft-2020-12", io: "input" }),
    { type: "string", description: "The recipe as JSON text" },
    // The request has always taken any value here (refused by the module): the contract still does (ARC-07 FR 3).
    { description: "Any other value is refused with 422 RECIPE_INVALID" },
  ].map((schema) => {
    const rest: Record<string, unknown> = { ...schema };
    delete rest["$schema"];
    return rest;
  }),
});

const summarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  schemaVersion: z.number().int(),
  /** The format fingerprint the recipe was made for (`fp1:` + SHA-256), if any. */
  fingerprint: z.string().nullable(),
  createdAt: z.string(),
  /** IMP-07 FR 1: «простір» or «рахунок» (then `accountId`). */
  scope: z.enum(["space", "account"]).meta({ "x-extensible-enum": true }),
  accountId: z.uuid().nullable(),
  /** IMP-07 FR 2, FR 3: the version a save names as `expectedVersion`. */
  version: z.number().int().min(1),
  updatedAt: z.string(),
  /** IMP-07 FR 5, EC1: «застарілий» — saved with an older schema; not applied until saved again from the editor. */
  stale: z.boolean(),
  /** IMP-07 FR 13: how many parses used the template, and when last (null — never). */
  useCount: z.number().int().min(0),
  lastUsedAt: z.string().nullable(),
});

const detailSchema = summarySchema.extend({
  /** The recipe (schema `schemaVersion`) without the account binding's value, which is kept sealed. */
  recipe: returnedRecipe,
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
    scope: scopeOf(r),
    accountId: r.accountId,
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
    stale: isStaleSchema(r.schemaVersion),
    useCount: r.useCount,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  };
}

const presentDetail = (r: StoredRecipe): z.input<typeof detailSchema> => ({
  ...presentSummary(r),
  recipe: r.recipe,
  accountValueLast4: r.accountValueLast4,
});

const versionSchema = z.object({
  version: z.number().int().min(1),
  name: z.string(),
  schemaVersion: z.number().int(),
  fingerprint: z.string().nullable(),
  savedAt: z.string(),
  /** The number of column rules: what the list of versions shows without the rules. */
  columnRules: z.number().int().min(0),
});

const presentVersion = (v: StoredVersion): z.input<typeof versionSchema> => ({
  version: v.version,
  name: v.name,
  schemaVersion: v.schemaVersion,
  fingerprint: v.fingerprint,
  savedAt: v.savedAt.toISOString(),
  columnRules: v.recipe.columns?.length ?? 0,
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
  if (error instanceof TemplateChangedError)
    return new ApiProblem("TEMPLATE_CHANGED", { extensions: { currentVersion: error.currentVersion } });
  if (error instanceof TemplateNameTakenError) return new ApiProblem("TEMPLATE_NAME_TAKEN");
  // Another space's account is the same answer as an unknown one.
  if (error instanceof TemplateAccountNotFoundError || error instanceof TemplateVersionNotFoundError)
    return new ApiProblem("NOT_FOUND");
  if (error instanceof TemplateAccountClosedError) return new ApiProblem("ACCOUNT_CLOSED");
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

/**
 * The recipe as the stored idempotency hash covers it (ARC-06 FR 2): the account binding's value is kept sealed, so the
 * unsalted hash in a clear column covers only its masked form — it cannot be searched for the full IBAN.
 */
function recipeForHash(recipe: unknown): unknown {
  let value = recipe;
  if (typeof recipe === "string") {
    try {
      value = JSON.parse(recipe);
    } catch {
      return recipe;
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const account = (value as Record<string, unknown>).account;
  if (account === null || typeof account !== "object" || Array.isArray(account)) return value;
  const sealed = (account as Record<string, unknown>).value;
  if (typeof sealed !== "string") return value;
  return { ...value, account: { ...account, value: accountValueLast4(sealed) } };
}

const templateName = z
  .string()
  .trim()
  .min(1)
  .max(RECIPE_NAME_MAX)
  .refine((name) => !unsafeText(name), { message: "control characters are not allowed" });
const fingerprint = z
  .string()
  .regex(/^fp1:[0-9a-f]{64}$/)
  .nullable()
  .optional();

const templateBody = z
  .object({
    name: templateName,
    /** The recipe as data (schema version 1); checked by the module, not by this schema. */
    recipe: requestRecipe,
    fingerprint,
    /**
     * IMP-07 FR 1: the account of this space the template is for (scope «рахунок»); left out or null — scope «простір».
     * Another space's or an unknown account is 404.
     */
    accountId: z.uuid().nullable().optional(),
  })
  .strict();

export const createImportRecipeRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/import/recipes",
  operationId: "createImportRecipe",
  summary:
    "Saves a parsing recipe as a template (IMP-06 FR 1, FR 14; IMP-07 FR 1, FR 2): checked whole; an invalid one is 422 RECIPE_INVALID with each error's code and path; a name taken in the same scope is 409",
  access: WRITE,
  create: true,
  idempotencyHashInput: ({ body }) => ({ ...body, recipe: recipeForHash(body.recipe) }),
  // Above the recipe's 32 KB, so that a larger recipe is refused with its own code (AC4), not by the body limit.
  bodyLimitBytes: 2 * RECIPE_LIMITS.bytes,
  request: {
    body: templateBody,
  },
  problems: ["RECIPE_INVALID", "LIMIT_REACHED", "TEMPLATE_NAME_TAKEN", "ACCOUNT_CLOSED"],
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
        {
          name: body.name,
          recipe: body.recipe,
          fingerprint: body.fingerprint ?? null,
          accountId: body.accountId ?? null,
        },
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
    importRecipesServices(ctx);
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

const versionParams = recipeParams.extend({ version: z.coerce.number().int().min(1) });

export const updateImportRecipeRoute = defineRoute({
  module: MODULE,
  method: "PUT",
  path: "/v1/import/recipes/{recipeId}",
  operationId: "updateImportRecipe",
  summary:
    "Saves an edited template as its next version (IMP-07 FR 2, FR 3): `expectedVersion` must be the current version, else 409 TEMPLATE_CHANGED «Шаблон змінено, оновіть»; a recipe that binds the account the same way without a value keeps the sealed one",
  access: WRITE,
  request: {
    params: recipeParams,
    body: templateBody.extend({
      /** The version the editor was opened with. */
      expectedVersion: z.number().int().min(1),
      /** Left out — the template keeps its fingerprint; null — none (applied only by hand, FR 4). */
      fingerprint,
      /** Left out — the scope stays; null — scope «простір»; an account — scope «рахунок». */
      accountId: z.uuid().nullable().optional(),
    }),
  },
  problems: ["RECIPE_INVALID", "TEMPLATE_CHANGED", "TEMPLATE_NAME_TAKEN", "ACCOUNT_CLOSED"],
  bodyLimitBytes: 2 * RECIPE_LIMITS.bytes,
  response: { status: 200, description: "The template's new version", schema: detailSchema },
  handler: async ({ params, body }, ctx) => {
    owner(ctx);
    const { deps, audit } = importRecipesServices(ctx);
    const { householdId, userId } = ctx.principal;
    const { result, handOffs } = await guarded(() =>
      updateTemplate(deps, routeTx(ctx), { actorId: userId, householdId }, params.recipeId, {
        name: body.name,
        recipe: body.recipe,
        expectedVersion: body.expectedVersion,
        ...(body.fingerprint !== undefined ? { fingerprint: body.fingerprint } : {}),
        ...(body.accountId !== undefined ? { accountId: body.accountId } : {}),
      }),
    );
    await handOffNow(audit, householdId, handOffs);
    return presentDetail(result);
  },
});

export const listImportRecipeVersionsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/recipes/{recipeId}/versions",
  operationId: "listImportRecipeVersions",
  summary: "The template's kept versions, newest first (IMP-07 FR 2: the last 20), without their rules",
  access: READ,
  request: { params: recipeParams },
  response: {
    status: 200,
    description: "The kept versions",
    schema: z.object({ items: z.array(versionSchema).max(20) }),
  },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    importRecipesServices(ctx);
    const versions = await guarded(() => routeTx(ctx)((tx) => templateVersions(tx, params.recipeId)));
    return { items: versions.map(presentVersion) };
  },
});

export const restoreImportRecipeVersionRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/import/recipes/{recipeId}/versions/{version}/restore",
  operationId: "restoreImportRecipeVersion",
  summary:
    "Restores a kept version (IMP-07 FR 2, AC11): its recipe becomes the template's next version; `expectedVersion` as for a save (FR 3)",
  access: WRITE,
  request: {
    params: versionParams,
    body: z.strictObject({ expectedVersion: z.number().int().min(1) }),
  },
  problems: ["TEMPLATE_CHANGED"],
  response: { status: 200, description: "The template's new version", schema: detailSchema },
  handler: async ({ params, body }, ctx) => {
    owner(ctx);
    const { deps, audit } = importRecipesServices(ctx);
    const { householdId, userId } = ctx.principal;
    const { result, handOffs } = await guarded(() =>
      restoreTemplateVersion(deps, routeTx(ctx), userId, params.recipeId, {
        version: params.version,
        expectedVersion: body.expectedVersion,
      }),
    );
    await handOffNow(audit, householdId, handOffs);
    return presentDetail(result);
  },
});

export const importRecipesRoutes = [
  createImportRecipeRoute,
  listImportRecipesRoute,
  getImportRecipeRoute,
  updateImportRecipeRoute,
  deleteImportRecipeRoute,
  listImportRecipeVersionsRoute,
  restoreImportRecipeVersionRoute,
];
