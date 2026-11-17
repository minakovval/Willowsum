import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import {
  listMerchants,
  mergeMerchants,
  merchantOfTransaction,
  renameMerchant,
  unmergeMerchant,
  type ChangeResult,
} from "../../application/index.ts";
import { MERCHANT_NAME_MAX, merchantInitials, type Merchant } from "../../domain/index.ts";
import { merchantsTx } from "../db/store.ts";
import { reviewGroupsRoutes } from "./review-groups.ts";
import { handOffNow, merchantsServices } from "./services.ts";

/**
 * The merchants of a space (BUD-14@PoC FR 1–3, AC1, AC10, AC11, AC13, AC16; wave 2 row 22 — the server part): the
 * merchant of a transaction in «Деталі транзакції» with «Оригінальний опис» and «Канал», «Перейменувати мерчанта»,
 * «Об'єднати з…» and «Роз'єднати». The space is the session's (П-5): a transaction or a merchant of another space is
 * «not found». A scoped member: «Транзакції» are closed by the visibility policy's default (00-general «Область
 * доступу») — not found on reads, and changes need `household.data.write`, which a scoped member never has. Behind the
 * release flag `transactions.merchants` (ships off) under the feature key of the same name; no plan limit (BUD-14
 * «Ліміти плану» names only the rules).
 */
const MODULE = "merchants";
const FEATURE = "transactions.merchants";

const merchantSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** FR 2, AC13: the initials on the grey disc that stands for every merchant (no logos in this release). */
  initials: z.string(),
  /** FR 1, AC11: a payment intermediary without a visible recipient («посередник»). */
  intermediary: z.boolean(),
  /** FR 3: the merchant this one joined («Об'єднати з…»), or null. */
  mergedInto: z.uuid().nullable(),
});

const present = (m: Merchant): z.input<typeof merchantSchema> => ({
  id: m.id,
  name: m.name,
  initials: merchantInitials(m.name),
  intermediary: m.intermediary,
  mergedInto: m.mergedInto,
});

const transactionMerchantSchema = z.object({
  transactionId: z.uuid(),
  /** «Оригінальний опис: …» — the counterparty as received or typed; never changed by a rename or a merge (FR 3). */
  originalDescription: z.string().nullable(),
  /** FR 1, AC10: «Канал: …» — the payment intermediary of the description, or null. */
  channel: z.string().nullable(),
  /** The merchant shown; null — the transaction has no counterparty. */
  merchant: merchantSchema.nullable(),
  /** FR 2: the description's own merchant joined into the one shown — the client offers «Роз'єднати» on it. */
  joinedFrom: merchantSchema.nullable(),
});

const merchantParams = z.object({ merchantId: z.uuid() });

/** Scoped members: «Транзакції» are closed by the visibility policy's default (00-general «Область доступу»). */
function refuseScoped(ctx: { principal: { scoped: boolean } }): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

function value(result: Exclude<ChangeResult, { kind: "ok" }>): never {
  switch (result.kind) {
    case "not-found":
      throw new ApiProblem("NOT_FOUND");
    case "merged":
      throw new ApiProblem("MERCHANT_MERGED");
    case "invalid":
      throw new ApiProblem("VALIDATION_FAILED", {
        errors: [{ in: "body", path: result.field, issue: result.issue }],
      });
  }
}

async function change(
  ctx: ProtectedContext,
  run: (tx: ReturnType<typeof merchantsTx>) => Promise<ChangeResult>,
): Promise<z.input<typeof merchantSchema>> {
  refuseScoped(ctx);
  const { audit } = merchantsServices(ctx);
  const result = await ctx.inHousehold((q) => run(merchantsTx(q)));
  if (result.kind !== "ok") value(result);
  await handOffNow(audit, ctx.principal.householdId, result.handOffs);
  return present(result.merchant);
}

export const getTransactionMerchantRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/transactions/{transactionId}/merchant",
  operationId: "getTransactionMerchant",
  summary:
    "«Деталі транзакції»: the merchant of a transaction cleaned from its description, «Оригінальний опис» and «Канал» (BUD-14 FR 1, FR 2)",
  access: { permission: "household.data.read", feature: FEATURE },
  request: { params: z.object({ transactionId: z.uuid() }) },
  response: { status: 200, description: "The transaction's merchant", schema: transactionMerchantSchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const { transactions } = merchantsServices(ctx);
    const householdId = ctx.principal.householdId;
    const texts = await transactions.counterparties(householdId, [params.transactionId]);
    if (!texts.has(params.transactionId)) throw new ApiProblem("NOT_FOUND");
    const found = await ctx.inHousehold((q) =>
      merchantOfTransaction(
        merchantsTx(q),
        householdId,
        params.transactionId,
        texts.get(params.transactionId)!,
      ),
    );
    return {
      transactionId: found.transactionId,
      originalDescription: found.originalDescription,
      channel: found.channel,
      merchant: found.merchant && present(found.merchant),
      joinedFrom: found.joinedFrom && present(found.joinedFrom),
    };
  },
});

export const listMerchantsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/merchants",
  operationId: "listMerchants",
  summary:
    "«Об'єднати з…»: the space's merchants that joined none, by name, with their transaction counts (BUD-14 FR 3)",
  access: { permission: "household.data.read", feature: FEATURE },
  request: {
    query: z.object({
      /** A part of the name, any case. */
      search: z.string().max(MERCHANT_NAME_MAX).optional(),
    }),
  },
  response: {
    status: 200,
    description: "The space's merchants",
    schema: z.object({
      items: z.array(
        merchantSchema.extend({
          /** The shown transactions of the merchant and of the ones that joined it. */
          transactionCount: z.number().int().min(0),
        }),
      ),
    }),
  },
  handler: async ({ query }, ctx) => {
    refuseScoped(ctx);
    const { transactions } = merchantsServices(ctx);
    const householdId = ctx.principal.householdId;
    const listed = await ctx.inHousehold((q) =>
      listMerchants(merchantsTx(q), transactions, householdId, query.search),
    );
    return {
      items: listed.map((l) => ({ ...present(l.merchant), transactionCount: l.transactionCount })),
    };
  },
});

export const renameMerchantRoute = defineRoute({
  module: MODULE,
  method: "PATCH",
  path: "/v1/merchants/{merchantId}",
  operationId: "renameMerchant",
  summary:
    "«Перейменувати мерчанта»: the space's name of a merchant; the original descriptions stay (BUD-14 FR 3)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 1024,
  problems: ["MERCHANT_MERGED"],
  request: {
    params: merchantParams,
    body: z
      .object({
        /** One line, 1–100 characters once trimmed. */
        name: z.string().max(400),
      })
      .strict(),
  },
  response: { status: 200, description: "The merchant", schema: merchantSchema },
  handler: async ({ params, body }, ctx) =>
    change(ctx, (tx) =>
      renameMerchant(tx, {
        householdId: ctx.principal.householdId,
        actorAccountId: ctx.principal.userId,
        merchantId: params.merchantId,
        name: body.name,
      }),
    ),
});

export const mergeMerchantsRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/merchants/{merchantId}/merge",
  operationId: "mergeMerchants",
  summary:
    "«Об'єднати з…»: the merchant of the body joins this one, whose name all their transactions show (BUD-14 FR 3, AC1)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 1024,
  problems: ["MERCHANT_MERGED"],
  request: {
    params: merchantParams,
    body: z
      .object({
        /** The merchant that joins; one of the space that joined none, not this one. */
        merchantId: z.uuid(),
      })
      .strict(),
  },
  response: { status: 200, description: "The merchant that stays", schema: merchantSchema },
  handler: async ({ params, body }, ctx) =>
    change(ctx, (tx) =>
      mergeMerchants(tx, {
        householdId: ctx.principal.householdId,
        actorAccountId: ctx.principal.userId,
        targetId: params.merchantId,
        sourceId: body.merchantId,
      }),
    ),
});

export const unmergeMerchantRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/merchants/{merchantId}/unmerge",
  operationId: "unmergeMerchant",
  summary:
    "«Роз'єднати»: a merchant that joined another is its own again with its transactions (BUD-14 FR 3, AC16)",
  access: { permission: "household.data.write", feature: FEATURE },
  request: { params: merchantParams },
  response: { status: 200, description: "The merchant, its own again", schema: merchantSchema },
  handler: async ({ params }, ctx) =>
    change(ctx, (tx) =>
      unmergeMerchant(tx, {
        householdId: ctx.principal.householdId,
        actorAccountId: ctx.principal.userId,
        merchantId: params.merchantId,
      }),
    ),
});

export const merchantsRoutes = [
  getTransactionMerchantRoute,
  listMerchantsRoute,
  renameMerchantRoute,
  mergeMerchantsRoute,
  unmergeMerchantRoute,
  ...reviewGroupsRoutes,
];
