import { z } from "zod";
import { isCurrencyCode } from "@willowsum/domain-kernel";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { decodeCursor, pageOf, pageQuery, toPage } from "../../../../platform/http/pagination.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import { REPORTING_CURRENCY } from "../../../fx-rates/index.ts";
import { cushionAverage, spendable, type GoalReads } from "../../application/index.ts";
import { goalsTx } from "../db/store.ts";
import { goalsServices } from "./services.ts";

/**
 * The goals' reads of other modules (BUD-05@PoC FR 8, FR 10, AC 3; #553, #559): the average monthly expenses for
 * «Подушка безпеки» and a page of the transactions «Витратити» may spend. The space is the session's; a scoped member
 * is refused as on every goals read (404: «бюджет і цілі» are closed by the visibility policy's default).
 */
const MODULE = "goals";
const FEATURE = "goals.savings";

const moneySchema = z.object({ amount: z.string(), currency: z.string() });

function readsOf(ctx: Parameters<typeof goalsServices>[0]): GoalReads {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
  const reads = goalsServices(ctx).deps.reads;
  if (!reads) throw new ApiProblem("INTERNAL");
  return reads;
}

export const cushionAverageRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/goals/emergency-average",
  operationId: "getGoalEmergencyAverage",
  summary:
    "«Подушка безпеки»: the space's average monthly expenses over the last 6 full months, without transfers (FR 10, AC 3)",
  access: { permission: "household.data.read", feature: FEATURE },
  request: {
    query: z.object({
      currency: z
        .string()
        .max(10)
        .optional()
        .meta({ description: "ISO 4217 code of the goal; the space's reporting currency by default" }),
    }),
  },
  response: {
    status: 200,
    description: "The average, the months it is over and the window",
    schema: z.object({
      currency: z.string(),
      /** Half to even to minor units; null — no expense in the window (or none with a rate). */
      average: moneySchema.nullable(),
      /** «за N міс.»: 0–6. */
      months: z.number().int(),
      from: z.string(),
      to: z.string(),
      /** Some day at the nearest earlier rate, or some left out without a rate. */
      approximate: z.boolean(),
      unavailableCount: z.number().int(),
    }),
  },
  handler: async ({ query }, ctx) => {
    const reads = readsOf(ctx);
    const currency = query.currency ?? REPORTING_CURRENCY;
    if (!isCurrencyCode(currency))
      throw new ApiProblem("VALIDATION_FAILED", {
        errors: [{ in: "query", path: "currency", issue: "invalid" }],
      });
    const a = await cushionAverage(
      reads,
      ctx.principal.householdId,
      currency,
      goalsServices(ctx).deps.today(),
    );
    return { ...a, average: a.average === null ? null : a.average.toJSON() };
  },
});

/** The position of the next page: the last row's date, time of recording and id. */
const position = z.object({ d: z.string().max(10), r: z.string().max(40), i: z.uuid() }).strict();

export const spendableRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/goals/{goalId}/spendable",
  operationId: "listGoalSpendable",
  summary:
    "«Витратити»: a page of the outgoing transactions the goal may spend — in its currency, on its part's account, not spent from a goal yet (FR 8)",
  access: { permission: "household.data.read", feature: FEATURE },
  list: true,
  request: {
    params: z.object({ goalId: z.uuid() }),
    query: z.object({
      ...pageQuery.shape,
      search: z.string().max(200).optional().meta({ description: "Counterparty or description contains it" }),
    }),
  },
  response: {
    status: 200,
    description: "The page, newest first, and how many there are in all («Ще N»)",
    schema: pageOf(
      z.object({
        id: z.uuid(),
        accountId: z.uuid(),
        counterparty: z.string().nullable(),
        description: z.string().nullable(),
        date: z.string(),
        /** What it takes from its account, without the sign, in the goal's currency. */
        amount: moneySchema,
      }),
    ).extend({ count: z.number().int() }),
  },
  handler: async ({ params, query }, ctx) => {
    const reads = readsOf(ctx);
    const householdId = ctx.principal.householdId;
    const at = query.cursor ? decodeCursor(query.cursor, position) : null;
    const search = query.search?.trim() ? query.search.trim() : null;
    const { goal, excluded } = await ctx.inHousehold(async (q) => {
      const tx = goalsTx(q);
      const goal = await tx.goal(householdId, params.goalId);
      return { goal, excluded: goal ? await tx.spentTransactionIds(householdId) : [] };
    });
    if (!goal) throw new ApiProblem("NOT_FOUND");
    const page = await spendable(reads, householdId, goal, excluded, {
      search,
      after: at === null ? null : { date: at.d, recordedAt: at.r, id: at.i },
      limit: query.limit + 1,
    });
    return {
      ...toPage(
        page.items,
        query.limit,
        (t) => ({
          id: t.id,
          accountId: t.accountId,
          counterparty: t.counterparty,
          description: t.description,
          date: t.date,
          amount: t.amount.toJSON(),
        }),
        (t) => ({ d: t.date, r: t.recordedAt, i: t.id }),
      ),
      count: page.count,
    };
  },
});
