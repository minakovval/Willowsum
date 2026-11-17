import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import { LIST_PAGE_QUERY } from "../../../../platform/lists/list-engine.ts";
import { decodeCursor, encodeCursor, pageOf, pageQuery } from "../../../../platform/http/pagination.ts";
import { reviewGroupIds, reviewGroups } from "../../application/index.ts";
import { merchantInitials, NO_MERCHANT_GROUP } from "../../domain/index.ts";
import { merchantsTx } from "../db/store.ts";
import { merchantsServices } from "./services.ts";

/**
 * BUD-12@PoC FR 14–16 (server part): «До розбору» in the mode «Мерчанти». The groups of the queue — one per merchant
 * shown (BUD-14 FR 1, FR 3; one more for the transactions without a merchant) with count, the exact sum per currency
 * and the suggested category — and the ids of a group's transactions, paged (at most 100 per page, ARC-07), for
 * «Підтвердити» of the group (bulk action `transactions.confirm-category`) and the pencil «Змінити категорію» (bulk
 * action `transactions.set-category`, then the confirmation). «Запам'ятати: <мерчант> → <категорія>» is a rule
 * (`POST /v1/category-rules`, condition «Мерчант дорівнює <назва>»); «Часто для <мерчанта>» — `GET
 * /v1/category-suggestions` with the group's `counterparty`; the progress (FR 15) — the counter `GET
 * /v1/transaction-review`. Behind the release flag and feature key `merchants.review-groups` (requires
 * `transactions.review`); no plan limit. A scoped member: «Транзакції» are closed (00-general «Область доступу»).
 */
const MODULE = "merchants";
const FEATURE = "merchants.review-groups";

function refuseScoped(ctx: { principal: { scoped: boolean } }): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

const cursorSchema = z.object({ id: z.uuid() }).strict();

const moneySchema = z.object({ amount: z.string(), currency: z.string() });

const groupSchema = z.object({
  /** The merchant's id, or `none` — the queued transactions without a merchant (no description to take one from). */
  id: z.string(),
  /** The merchant shown (a merge's target, else the description's own); null for the group `none`. */
  merchant: z
    .object({ id: z.uuid(), name: z.string(), initials: z.string(), intermediary: z.boolean() })
    .nullable(),
  /** FR 14 «кількість транзакцій». */
  count: z.number().int().min(1),
  /** FR 14 «сума»: the signed sum per currency (minus — expenses), exact decimal strings, by currency code. */
  totals: z.array(moneySchema),
  /** The date of the group's oldest transaction. */
  oldest: z.iso.date(),
  /** FR 14 «запропонована категорія»: the category most of the group's transactions have; null — none has one. */
  suggestedCategoryId: z.uuid().nullable(),
  /**
   * Not every transaction of the group has the suggested category: «Підтвердити» of the group then sets it first
   * (bulk action `transactions.set-category`), so the whole group is confirmed with the category the row showed.
   */
  mixedCategories: z.boolean(),
  /** The group's most frequent original description: `counterparty` of «Часто для <мерчанта>» (FR 16); null — none. */
  counterparty: z.string().nullable(),
});

export const listReviewGroupsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/transaction-review/merchant-groups",
  operationId: "listTransactionReviewGroups",
  summary:
    "«До розбору» in the mode «Мерчанти»: the queue grouped by merchant — count, sum per currency and suggested category, the largest group first (BUD-12 FR 14, FR 15)",
  access: { permission: "household.data.read", feature: FEATURE },
  request: { query: z.object(LIST_PAGE_QUERY) },
  response: {
    status: 200,
    description: "One page of the groups",
    schema: z.object({
      items: z.array(groupSchema),
      page: z.number().int().min(1),
      pageSize: z.number().int(),
      /** How many groups. */
      count: z.number().int().min(0),
      /** FR 15: how many transactions the queue has — the progress counts transactions, not groups. */
      transactionCount: z.number().int().min(0),
      /**
       * The queue was larger than one read takes (20 000 counterparty × currency slices, or 20 000 transactions of
       * the page's groups for their suggestion): the rest is left out until the queue is smaller.
       */
      truncated: z.boolean(),
    }),
  },
  handler: async ({ query }, ctx) => {
    refuseScoped(ctx);
    const { transactions, categories } = merchantsServices(ctx);
    if (!categories) throw new ApiProblem("INTERNAL");
    const householdId = ctx.principal.householdId;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const result = await ctx.inHousehold((q) =>
      reviewGroups(merchantsTx(q), transactions, categories, householdId, { page, pageSize }),
    );
    return {
      items: result.items.map((g) => ({
        id: g.key,
        merchant: g.merchant && {
          id: g.merchant.id,
          name: g.merchant.name,
          initials: merchantInitials(g.merchant.name),
          intermediary: g.merchant.intermediary,
        },
        count: g.count,
        totals: g.totals.map((m) => m.toJSON()),
        oldest: g.oldest,
        suggestedCategoryId: g.suggestion.categoryId,
        mixedCategories: g.suggestion.mixed,
        counterparty: g.counterparty,
      })),
      page,
      pageSize,
      count: result.count,
      transactionCount: result.transactionCount,
      truncated: result.truncated,
    };
  },
});

export const listReviewGroupIdsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/transaction-review/merchant-groups/{groupId}/transactions",
  operationId: "listTransactionReviewGroupIds",
  summary:
    "The ids of a merchant group's transactions in «До розбору», page by page — the selection of «Підтвердити» of the group and of «Змінити категорію» (BUD-12 FR 14, FR 16)",
  access: { permission: "household.data.read", feature: FEATURE },
  list: true,
  request: {
    params: z.object({
      /** A group's `id`: a merchant shown in the mode (one that joined another is no group — 404), or `none`. */
      groupId: z.union([z.uuid(), z.literal(NO_MERCHANT_GROUP)]),
    }),
    query: z.object({ ...pageQuery.shape }),
  },
  response: {
    status: 200,
    description: "The ids of the group's transactions, by id",
    schema: pageOf(z.uuid()),
  },
  handler: async ({ params, query }, ctx) => {
    refuseScoped(ctx);
    const { transactions } = merchantsServices(ctx);
    const householdId = ctx.principal.householdId;
    const after = query.cursor === undefined ? null : decodeCursor(query.cursor, cursorSchema).id;
    const result = await ctx.inHousehold((q) =>
      reviewGroupIds(merchantsTx(q), transactions, householdId, params.groupId, {
        after,
        limit: query.limit,
      }),
    );
    if (result === null) throw new ApiProblem("NOT_FOUND");
    return {
      items: [...result.ids],
      nextCursor: result.next === null ? null : encodeCursor({ id: result.next }),
    };
  },
});

export const reviewGroupsRoutes = [listReviewGroupsRoute, listReviewGroupIdsRoute];
