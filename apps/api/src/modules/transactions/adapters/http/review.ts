import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import { setReview, type ReviewStep } from "../../application/index.ts";
import { reviewQueueCount, transactionsTx } from "../db/store.ts";
import { caller, handOffNow, params, refuseScoped, shown, transactionSchema } from "./routes.ts";
import { REVIEW_FLAG, transactionsServices } from "./services.ts";

/**
 * BUD-12@PoC a) (wave 2 row 24): «До розбору» — the space's one queue (FR 10) of transactions whose category is to be
 * confirmed. The queue itself is the list «Транзакції» with `filter=review.eq:queued&sort=date` (FR 2: oldest first;
 * its count is «До розбору · N» and the progress «0 з 12», FR 15); here — the counter of the side menu (FR 2, AC9) and
 * a card's «Підтвердити» and its «Відмінити» (FR 4, FR 6, FR 7). «Пропустити» (FR 5) changes nothing on the server;
 * «Підтвердити категорії» of the selection panel (FR 12) and of a merchant's group (FR 14) is the bulk action
 * `transactions.confirm-category` (adapters/bulk/review.ts). Behind the release flag and feature key
 * `transactions.review`, which requires `transactions.manual`; no plan limit. A transaction of another space is «not
 * found»; scoped members: «Транзакції» are closed (00-general «Область доступу»).
 */
const MODULE = "transactions";

export const reviewCountRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/transaction-review",
  operationId: "getTransactionReviewCount",
  summary:
    "The counter of «До розбору»: on «Транзакції» in the side menu (none when 0) and on the tab «До розбору · N» (BUD-12 FR 2, AC9)",
  access: { permission: "household.data.read", feature: REVIEW_FLAG },
  response: {
    status: 200,
    description: "How many transactions of the space are in the queue (shown ones)",
    schema: z.object({ count: z.number().int() }),
  },
  handler: async (_input, ctx) => {
    refuseScoped(ctx);
    transactionsServices(ctx);
    return { count: await ctx.inHousehold((q) => reviewQueueCount(q, ctx.principal.householdId)) };
  },
});

const reviewRoute = (step: ReviewStep) =>
  defineRoute({
    module: MODULE,
    method: "POST",
    path: `/v1/transactions/{transactionId}/review/${step}`,
    operationId: step === "confirm" ? "confirmTransactionReview" : "reopenTransactionReview",
    summary:
      step === "confirm"
        ? "«Підтвердити» on a card of «До розбору»: the category is confirmed (who and when — in the audit log) and the transaction leaves the queue; a confirmed one — nothing (BUD-12 FR 4, FR 7)"
        : "«Відмінити» of a confirmation: the transaction is back in «До розбору» with its previous state; one in the queue — nothing (BUD-12 FR 6)",
    access: { permission: "household.data.write", feature: REVIEW_FLAG },
    bodyLimitBytes: 1024,
    problems: ["VERSION_CONFLICT", "TRANSACTION_NOT_IN_REVIEW", "TRANSACTION_MERGED"],
    request: {
      params,
      body: z
        .object({
          /**
           * The transaction's `version` as the card shows it (FR 7): changed meanwhile — 409 VERSION_CONFLICT with
           * `currentVersion`; the card reloads and shows «Транзакцію змінено, перевірте ще раз».
           */
          version: z.number().int().min(1),
          /**
           * The category the card shows (FR 7; null — «Без категорії»), confirm only: the category is module
           * categorization's, so a change of it alone leaves `version` as it is; another — 409 VERSION_CONFLICT.
           */
          categoryId: z.uuid().nullable().optional(),
        })
        .strict(),
    },
    response: { status: 200, description: "The transaction after the change", schema: transactionSchema },
    handler: async ({ params, body }, ctx) => {
      refuseScoped(ctx);
      const { deps, categoryOf } = transactionsServices(ctx);
      if (step === "confirm" && body.categoryId !== undefined) {
        if (!categoryOf) throw new ApiProblem("INTERNAL");
        const current = await categoryOf.categoriesOf(ctx.principal.householdId, [params.transactionId]);
        const currentCategoryId = current.get(params.transactionId) ?? null;
        // `currentCategoryId` lets the card show the new category without a reload (null — «Без категорії»).
        if (currentCategoryId !== body.categoryId)
          throw new ApiProblem("VERSION_CONFLICT", {
            extensions: { currentVersion: body.version, currentCategoryId },
          });
      }
      const result = await ctx.inHousehold((q) =>
        setReview(transactionsTx(q), caller(ctx), params.transactionId, body.version, step),
      );
      switch (result.kind) {
        case "not-found":
          throw new ApiProblem("NOT_FOUND");
        case "conflict":
          throw new ApiProblem("VERSION_CONFLICT", { extensions: { currentVersion: result.version } });
        case "not-queued":
          throw new ApiProblem("TRANSACTION_NOT_IN_REVIEW");
        case "merged":
          throw new ApiProblem("TRANSACTION_MERGED");
      }
      await handOffNow(ctx, deps, result.handOff);
      return shown(ctx, result.transaction);
    },
  });

export const confirmReviewRoute = reviewRoute("confirm");
export const reopenReviewRoute = reviewRoute("reopen");

export const reviewRoutes = [reviewCountRoute, confirmReviewRoute, reopenReviewRoute];
