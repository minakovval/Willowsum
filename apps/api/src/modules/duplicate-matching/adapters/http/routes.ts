import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import { listDuplicates } from "../../application/index.ts";
import type { DuplicateSide } from "../../domain/index.ts";
import { duplicateMatchingServices } from "./services.ts";

/**
 * «Можливий дубль» in «До розбору» of the page «Транзакції» (FIN-03@PoC FR 12, FR 25; wave 2 row 16c): the pairs that
 * may be one operation entered twice. The space is the session's (П-5). A scoped member: «Транзакції» are closed by the
 * visibility policy's default — not found. Behind the release flag and feature key `transactions.duplicates` (requires
 * `transactions.manual`); no plan limit.
 */
const MODULE = "duplicate-matching";
const FEATURE = "transactions.duplicates";

const sideSchema = z.object({
  transactionId: z.uuid(),
  accountId: z.uuid(),
  /** Signed, in the account's currency; the same in both sides. */
  amount: z.object({ amount: z.string(), currency: z.string() }),
  date: z.string(),
});

const side = (s: DuplicateSide): z.input<typeof sideSchema> => ({
  transactionId: s.transactionId,
  accountId: s.accountId,
  amount: s.amount.toJSON(),
  date: s.date,
});

export const listDuplicatesRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/duplicate-proposals",
  operationId: "listDuplicateProposals",
  summary:
    "«Можливий дубль»: two transactions on one account with the same amount and currency within 3 days; never merged or hidden by the system",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description:
      "The pairs, newest first; «Об'єднати» is POST /v1/transactions/{first}/merge with the second as the duplicate, «Не дубль» POST /v1/transactions/{first}/not-duplicate",
    schema: z.object({
      items: z.array(z.object({ first: sideSchema, second: sideSchema })),
      count: z.number().int(),
      /** The search looked at its most pairs; older ones come once these are decided. */
      more: z.boolean(),
    }),
  },
  handler: async (_input, ctx) => {
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    const { deps } = duplicateMatchingServices(ctx);
    const { pairs, more } = await listDuplicates(deps, ctx.principal.householdId);
    return {
      items: pairs.map((p) => ({ first: side(p.first), second: side(p.second) })),
      count: pairs.length,
      more,
    };
  },
});

export const duplicateMatchingRoutes = [listDuplicatesRoute];
