import { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import {
  createCategory,
  createGroup,
  ensureTree,
  mergeCategory,
  readTree,
  renameGroup,
  updateCategory,
  type Result,
  type StoredCategory,
  type StoredGroup,
} from "../../application/index.ts";
import { CATEGORY_KINDS, iconTone, NAME_MAX } from "../../domain/index.ts";
import { categoriesTx } from "../db/store.ts";
import { categoriesServices } from "./services.ts";

/**
 * The category tree of a space (BUD-01@PoC FR 1–3, FR 8, FR 10, FR 11; wave 2 row 19): read the tree, add groups and
 * categories, rename, hide or show, icon and colour, «обов'язкова», merge. No delete (FR 3; deleting a custom
 * category is an open owner question). The space is the session's (П-5): a category or group of another space is
 * «not found». A scoped member: «бюджет і цілі» are closed by the visibility policy's default (00-general «Область
 * доступу») — not found on reads, and changes need `household.data.write`, which a scoped member never has. Behind
 * the release flag `categories.tree` (ships off) under the feature key of the same name; no plan limit.
 */
const MODULE = "categories";
const FEATURE = "categories.tree";

const categorySchema = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  /** The key of a system category (the client shows its name in the user's language unless renamed); null — custom. */
  systemKey: z.string().nullable(),
  kind: z.enum(CATEGORY_KINDS),
  name: z.string(),
  /** A system category with a name of the user's (FR 3). */
  renamed: z.boolean(),
  /** A Lucide icon (FR 10). */
  icon: z.string(),
  color: z.string().meta({ description: "#RRGGBB of the circle" }),
  /** FR 10: white when white on the colour has a contrast of at least 3 : 1, else `ink`. */
  iconTone: z.enum(["white", "ink"]),
  /** FR 11: «обов'язкова»; null for income and service categories. */
  essential: z.boolean().nullable(),
  /** FR 3: out of the budget plan; its transactions count in «Інше». */
  hidden: z.boolean(),
});

const groupSchema = z.object({
  id: z.uuid(),
  systemKey: z.string().nullable(),
  kind: z.enum(CATEGORY_KINDS),
  name: z.string(),
  renamed: z.boolean(),
  tone: z.string(),
  categories: z.array(categorySchema),
});

function presentCategory(c: StoredCategory): z.input<typeof categorySchema> {
  return {
    id: c.id,
    groupId: c.groupId,
    systemKey: c.systemKey,
    kind: c.kind,
    name: c.name,
    renamed: c.renamed,
    icon: c.icon,
    color: c.color,
    iconTone: iconTone(c.color),
    essential: c.essential,
    hidden: c.state === "hidden",
  };
}

function presentGroup(g: StoredGroup, categories: readonly StoredCategory[]): z.input<typeof groupSchema> {
  return {
    id: g.id,
    systemKey: g.systemKey,
    kind: g.kind,
    name: g.name,
    renamed: g.renamed,
    tone: g.tone,
    categories: categories.map(presentCategory),
  };
}

function value<T>(result: Result<T>): T {
  switch (result.kind) {
    case "ok":
      return result.value;
    case "invalid":
      throw new ApiProblem("VALIDATION_FAILED", {
        errors: result.issues.map((i) => ({ in: "body" as const, path: i.field, issue: i.issue })),
      });
    case "name-taken":
      throw new ApiProblem("CATEGORY_NAME_TAKEN");
    case "kinds-differ":
      throw new ApiProblem("CATEGORY_KINDS_DIFFER");
    case "service-fixed":
      throw new ApiProblem("CATEGORY_SERVICE_FIXED");
    case "not-found":
      throw new ApiProblem("NOT_FOUND");
  }
}

const UNIQUE_NAMES = new Set(["categories_name", "category_groups_name"]);

/**
 * One request: the system tree of the space first (its own transaction, so a refused change never takes it back),
 * then the work. A concurrent writer of the same name is refused by the unique index: «Така назва вже існує».
 */
async function inTree<T>(
  ctx: ProtectedContext,
  work: (q: HouseholdQueryRunner, deps: ReturnType<typeof categoriesServices>["deps"]) => Promise<T>,
): Promise<T> {
  const { deps } = categoriesServices(ctx);
  await ctx.inHousehold((q) => ensureTree(deps, categoriesTx(q), ctx.principal.householdId));
  try {
    return await ctx.inHousehold((q) => work(q, deps));
  } catch (error) {
    const pg = error as { code?: string; constraint?: string };
    if (pg.code === "23505" && UNIQUE_NAMES.has(pg.constraint ?? ""))
      throw new ApiProblem("CATEGORY_NAME_TAKEN");
    throw error;
  }
}

/** Scoped members: «бюджет і цілі» are closed by the visibility policy's default (00-general «Область доступу»). */
function refuseScoped(ctx: { principal: { scoped: boolean } }): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

const caller = (ctx: ProtectedContext) => ({
  householdId: ctx.principal.householdId,
  accountId: ctx.principal.userId,
});

const nameInput = z.string().max(NAME_MAX * 4);
const categoryParams = z.object({ categoryId: z.uuid() });
const groupParams = z.object({ groupId: z.uuid() });
const BODY_LIMIT = 4 * 1024;

export const listCategoriesRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/categories",
  operationId: "listCategories",
  summary:
    "«Налаштування → Категорії»: the space's tree — groups in order, each with its categories (hidden too)",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description: "The tree; the system tree is always there (FR 1)",
    schema: z.object({ groups: z.array(groupSchema) }),
  },
  handler: async (_input, ctx) => {
    refuseScoped(ctx);
    const tree = await inTree(ctx, (q) => readTree(categoriesTx(q), ctx.principal.householdId));
    return { groups: tree.map(({ group, categories }) => presentGroup(group, categories)) };
  },
});

export const getCategoryRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/categories/{categoryId}",
  operationId: "getCategory",
  summary: "One category of the space; another space's or one out of use is not found",
  access: { permission: "household.data.read", feature: FEATURE },
  request: { params: categoryParams },
  response: { status: 200, description: "The category", schema: categorySchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const row = await inTree(ctx, (q) =>
      categoriesTx(q).category(ctx.principal.householdId, params.categoryId),
    );
    if (!row || row.state === "retired") throw new ApiProblem("NOT_FOUND");
    return presentCategory(row);
  },
});

export const createGroupRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/category-groups",
  operationId: "createCategoryGroup",
  summary: "«Додати» a custom group of type «дохід» or «витрата» (FR 2)",
  access: { permission: "household.data.write", feature: FEATURE },
  create: true,
  bodyLimitBytes: BODY_LIMIT,
  problems: ["CATEGORY_NAME_TAKEN"],
  request: { body: z.object({ name: nameInput, kind: z.enum(["expense", "income"]) }).strict() },
  response: { status: 201, description: "The new group, without categories", schema: groupSchema },
  handler: async ({ body }, ctx) => {
    const group = await inTree(ctx, async (q, deps) =>
      value(await createGroup(deps, categoriesTx(q), caller(ctx), body)),
    );
    return presentGroup(group, []);
  },
});

export const renameGroupRoute = defineRoute({
  module: MODULE,
  method: "PATCH",
  path: "/v1/category-groups/{groupId}",
  operationId: "renameCategoryGroup",
  summary: "«Перейменувати» a group; a system group shows its new name (FR 2, FR 3)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: BODY_LIMIT,
  problems: ["CATEGORY_NAME_TAKEN"],
  request: { params: groupParams, body: z.object({ name: nameInput }).strict() },
  response: { status: 200, description: "The group with its categories", schema: groupSchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { group, categories } = await inTree(ctx, async (q, deps) => {
      const tx = categoriesTx(q);
      const renamed = value(await renameGroup(deps, tx, caller(ctx), params.groupId, body));
      const all = await tx.categories(ctx.principal.householdId);
      return { group: renamed, categories: all.filter((c) => c.groupId === renamed.id) };
    });
    return presentGroup(group, categories);
  },
});

export const createCategoryRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/categories",
  operationId: "createCategory",
  summary: "«Додати» a custom category to a group of income or expenses (FR 2)",
  access: { permission: "household.data.write", feature: FEATURE },
  create: true,
  bodyLimitBytes: BODY_LIMIT,
  problems: ["CATEGORY_NAME_TAKEN"],
  request: {
    body: z
      .object({
        groupId: z.uuid(),
        name: nameInput,
        /** A Lucide icon; by default `shapes`. */
        icon: z.string().max(64).optional(),
        /** #RRGGBB; by default the group's tone. */
        color: z.string().max(7).optional(),
        /** Expense groups only; off by default (FR 11). */
        essential: z.boolean().optional(),
      })
      .strict(),
  },
  response: { status: 201, description: "The new category", schema: categorySchema },
  handler: async ({ body }, ctx) =>
    presentCategory(
      await inTree(ctx, async (q, deps) =>
        value(await createCategory(deps, categoriesTx(q), caller(ctx), body)),
      ),
    ),
});

export const updateCategoryRoute = defineRoute({
  module: MODULE,
  method: "PATCH",
  path: "/v1/categories/{categoryId}",
  operationId: "updateCategory",
  summary:
    "«Перейменувати», «Приховати» or show again, icon and colour, «обов'язкова»: the fields sent change (FR 2, 3, 10, 11)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: BODY_LIMIT,
  problems: ["CATEGORY_NAME_TAKEN", "CATEGORY_SERVICE_FIXED"],
  request: {
    params: categoryParams,
    body: z
      .object({
        name: nameInput.optional(),
        hidden: z.boolean().optional(),
        icon: z.string().max(64).optional(),
        color: z.string().max(7).optional(),
        essential: z.boolean().optional(),
      })
      .strict(),
  },
  response: { status: 200, description: "The category after the change", schema: categorySchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    return presentCategory(
      await inTree(ctx, async (q, deps) =>
        value(await updateCategory(deps, categoriesTx(q), caller(ctx), params.categoryId, body)),
      ),
    );
  },
});

export const mergeCategoryRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/categories/{categoryId}/merge",
  operationId: "mergeCategory",
  summary:
    "«Об'єднати» with a category of the same type: its transactions, rules and limit go to the target (FR 8)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: BODY_LIMIT,
  problems: ["CATEGORY_KINDS_DIFFER", "CATEGORY_SERVICE_FIXED"],
  request: { params: categoryParams, body: z.object({ targetId: z.uuid() }).strict() },
  response: {
    status: 200,
    description:
      "Merged: a system category is hidden (it may be shown again), a custom one is out of use; the records follow",
    schema: z.object({ sourceId: z.uuid(), targetId: z.uuid(), sourceState: z.enum(["hidden", "retired"]) }),
  },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { source, target } = await inTree(ctx, async (q, deps) =>
      value(await mergeCategory(deps, categoriesTx(q), caller(ctx), params.categoryId, body)),
    );
    return { sourceId: source.id, targetId: target.id, sourceState: source.state as "hidden" | "retired" };
  },
});

export const categoriesRoutes = [
  listCategoriesRoute,
  getCategoryRoute,
  createCategoryRoute,
  updateCategoryRoute,
  mergeCategoryRoute,
  createGroupRoute,
  renameGroupRoute,
];
