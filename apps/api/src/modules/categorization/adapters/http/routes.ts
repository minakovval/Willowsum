import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import {
  categoryOf,
  checkChange,
  setCategory,
  type SetResult,
  type StoredTransactionCategory,
} from "../../application/index.ts";
import { CATEGORY_SOURCES } from "../../domain/index.ts";
import { rulesTx } from "../db/rules.ts";
import { categorizationTx } from "../db/store.ts";
import { rulesRoutes } from "./rules.ts";
import { runsRoutes } from "./runs.ts";
import { getCategorySuggestionsRoute } from "./suggestions.ts";
import { categorizationServices, handOffNow } from "./services.ts";

/**
 * The category of a transaction (BUD-01@PoC FR 1, FR 4, FR 5, FR 9; AC8; wave 2 row 20): read it and change it by hand
 * in «Деталі транзакції» — only that transaction changes. The space is the session's (П-5): a transaction or a
 * category of another space is «not found». A scoped member: «Транзакції» are closed by the visibility policy's
 * default (00-general «Область доступу») — not found on reads, and changes need `household.data.write`, which a scoped
 * member never has. Behind the release flag `categories.tree` (ships off) under the feature key of the same name, as
 * the category tree (BUD-01 a); no plan limit (BUD-01 «Ліміти плану»).
 */
const MODULE = "categorization";
const FEATURE = "categories.tree";

const params = z.object({ transactionId: z.uuid() });

const categorySchema = z.object({
  transactionId: z.uuid(),
  /** A category of the space's tree (`GET /v1/categories`); null — «Без категорії» (FR 1). */
  categoryId: z.uuid().nullable(),
  /**
   * FR 4: «вручну» (`manual`), «за правилом» (`rule`), «як раніше» (`merchant`), «з банку» (`bank`), «за словником»
   * (`dictionary`), «немає» (`none` — «Без категорії»).
   */
  source: z.enum(CATEGORY_SOURCES),
  /**
   * BUD-14 FR 8, FR 13: «за правилом №…» — the rule that set the category (`source` «rule») and its place in the order
   * now; absent — no rule (or it is no longer there).
   */
  rule: z.object({ id: z.uuid(), position: z.number().int() }).optional(),
  /**
   * BUD-14 FR 8, AC3: «Застосовано правила: №…» — the rules that set the category and the tags, in priority order now;
   * absent — none (or no longer there).
   */
  appliedRules: z.array(z.object({ id: z.uuid(), position: z.number().int() })).optional(),
});

const present = (
  row: StoredTransactionCategory,
  position: number | null = null,
  applied: readonly { id: string; position: number }[] = [],
): z.input<typeof categorySchema> => ({
  transactionId: row.transactionId,
  categoryId: row.categoryId,
  source: row.source,
  ...(row.ruleId !== null && position !== null ? { rule: { id: row.ruleId, position } } : {}),
  ...(applied.length > 0 ? { appliedRules: [...applied] } : {}),
});

/** Scoped members: «Транзакції» are closed by the visibility policy's default (00-general «Область доступу»). */
function refuseScoped(ctx: { principal: { scoped: boolean } }): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

function value(result: Exclude<SetResult, { kind: "ok" }>): never {
  switch (result.kind) {
    case "not-found":
      throw new ApiProblem("NOT_FOUND");
    case "refused":
      throw new ApiProblem(
        result.issue === "in_transfer"
          ? "TRANSACTION_IN_TRANSFER"
          : result.issue === "merged"
            ? "TRANSACTION_MERGED"
            : "TRANSACTION_SPLIT",
      );
    case "invalid":
      throw new ApiProblem("VALIDATION_FAILED", {
        errors: [{ in: "body", path: result.field, issue: result.issue }],
      });
    case "conflict":
      throw new ApiProblem("VERSION_CONFLICT");
  }
}

async function existing(ctx: ProtectedContext, transactionId: string): Promise<void> {
  const { deps } = categorizationServices(ctx);
  const facts = await deps.transactions.facts(ctx.principal.householdId, [transactionId]);
  if (!facts.has(transactionId)) throw new ApiProblem("NOT_FOUND");
}

export const getTransactionCategoryRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/transactions/{transactionId}/category",
  operationId: "getTransactionCategory",
  summary:
    "The category of a transaction and its source (BUD-01 FR 4); «Без категорії» — no category, source «none»",
  access: { permission: "household.data.read", feature: FEATURE },
  request: { params },
  response: { status: 200, description: "The transaction's category", schema: categorySchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    await existing(ctx, params.transactionId);
    const householdId = ctx.principal.householdId;
    const { row, position, applied } = await ctx.inHousehold(async (q) => {
      const found = await categoryOf(categorizationTx(q), householdId, params.transactionId);
      const refs = [found.ruleId, found.tagRuleId ?? null].filter((id): id is string => id !== null);
      const rules = refs.length === 0 ? [] : await rulesTx(q).rules(householdId);
      const rule = rules.find((r) => r.id === found.ruleId);
      const applied = rules
        .filter((r) => refs.includes(r.id))
        .map((r) => ({ id: r.id, position: r.position }));
      return { row: found, position: rule?.position ?? null, applied };
    });
    return present(row, position, applied);
  },
});

export const setTransactionCategoryRoute = defineRoute({
  module: MODULE,
  method: "PUT",
  path: "/v1/transactions/{transactionId}/category",
  operationId: "setTransactionCategory",
  summary:
    "«Категорія» in «Деталі транзакції»: the user's category of this one transaction — «вручну»; null — «Без категорії» (BUD-01 FR 5, AC8)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 1024,
  problems: ["TRANSACTION_IN_TRANSFER", "TRANSACTION_MERGED", "TRANSACTION_SPLIT", "VERSION_CONFLICT"],
  request: {
    params,
    body: z
      .object({
        /** A category of the space's tree in use, not a service one (FR 9); null — «Без категорії». */
        categoryId: z.uuid().nullable(),
      })
      .strict(),
  },
  response: { status: 200, description: "The transaction's category", schema: categorySchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { deps, audit } = categorizationServices(ctx);
    const householdId = ctx.principal.householdId;
    const refused = await checkChange(deps, householdId, params.transactionId, body.categoryId);
    if (refused !== null) value(refused);
    const result = await ctx.inHousehold((q) =>
      setCategory(categorizationTx(q), {
        householdId,
        actorAccountId: ctx.principal.userId,
        transactionId: params.transactionId,
        categoryId: body.categoryId,
      }),
    );
    if (result.kind !== "ok") value(result);
    await handOffNow(audit, householdId, result.handOff);
    return present(result.row);
  },
});

export const categorizationRoutes = [
  getTransactionCategoryRoute,
  setTransactionCategoryRoute,
  ...rulesRoutes,
  ...runsRoutes,
  getCategorySuggestionsRoute,
];
