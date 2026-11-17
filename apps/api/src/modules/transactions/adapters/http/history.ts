import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import { HISTORY_ENTITIES, transactionHistory } from "../../domain/history.ts";
import { transactionsTx } from "../db/store.ts";
import { params, refuseScoped } from "./routes.ts";
import { HISTORY_FLAG, transactionsServices } from "./services.ts";

/**
 * FIN-03@PoC FR 27 (issue #439): «Історія змін» of the details S-047 — the transaction's entries in the space's own
 * audit log (FR 20), oldest first (domain/history.ts). Behind the release flag and feature key `transactions.history`,
 * which requires `transactions.manual`; no plan limit. The space is the session's: a transaction of another space (or
 * a deleted one) is «not found» and nothing of its log is read; scoped members: «Транзакції» are closed (00-general
 * «Область доступу») — 404, like the transaction itself.
 */
const MODULE = "transactions";

const changeSchema = z.object({
  /** The audited field (`amount`, `date`, `counterparty`, `hidden`, `split.*`, `transfer.*`, `categoryId`, …). */
  field: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  /** Free text (counterparty, description, note): the values are `•••` (or null when there was none), never the text. */
  masked: z.boolean(),
});

export const historyEntrySchema = z.object({
  id: z.uuid(),
  /** When (UTC, ISO 8601). */
  occurredAt: z.string(),
  /** Who, relative to the reader: never an account id. */
  actor: z.enum(["you", "member", "staff", "system"]),
  channel: z.string(),
  action: z.enum(["create", "update", "delete"]),
  changes: z.array(changeSchema),
});

export const transactionHistoryRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/transactions/{transactionId}/history",
  operationId: "getTransactionHistory",
  summary:
    "«Історія змін» in the details: what the audit log recorded about the transaction and its category, oldest first; free text masked (FIN-03 FR 20, FR 27)",
  access: { permission: "household.data.read", feature: HISTORY_FLAG },
  request: { params },
  response: {
    status: 200,
    description: "The transaction's history",
    schema: z.object({ items: z.array(historyEntrySchema) }),
  },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const { history } = transactionsServices(ctx);
    if (!history) throw new ApiProblem("INTERNAL");
    const householdId = ctx.principal.householdId;
    // The row first, under the space's policy: another space's transaction is never looked up in the log.
    const row = await ctx.inHousehold((q) => transactionsTx(q).find(householdId, params.transactionId));
    if (!row) throw new ApiProblem("NOT_FOUND");
    const entries = (
      await Promise.all(HISTORY_ENTITIES.map((type) => history.entriesFor(householdId, { type, id: row.id })))
    ).flat();
    return {
      items: transactionHistory(entries, ctx.principal.userId).map((e) => ({
        ...e,
        changes: [...e.changes],
      })),
    };
  },
});

export const historyRoutes = [transactionHistoryRoute];
