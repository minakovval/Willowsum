import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import {
  deleteTag,
  renameTag,
  setAttributes,
  setOneOff,
  type TagAudit,
  type TransactionsDeps,
} from "../../application/index.ts";
import { NOTE_MAX, TAG_NAME_MAX, TAGS_PER_TRANSACTION_MAX } from "../../domain/index.ts";
import { selectionGroups, transactionsTx } from "../db/store.ts";
import { tagsTx, tagsWithCounts } from "../db/tags.ts";
import {
  ATTRIBUTES,
  caller,
  FEATURE,
  handOffNow,
  invalid,
  ONE_OFF,
  outcome,
  params,
  refuseScoped,
  shown,
  transactionSchema,
} from "./routes.ts";
import { transactionsServices } from "./services.ts";

/**
 * BUD-13@PoC a) (wave 2 row 21): «Нотатка» and «Теги» of a transaction, the space's tags (renamed — onto another's name:
 * merged — and deleted after the confirmation with their count), and «Вибрано N · Сума ±X €» of the selection panel
 * (FR 9). Behind the release flag and feature key `transactions.attributes` (BUD-13: «атрибути транзакцій»), which
 * requires `transactions.manual`; the selection sum is the list's (`transactions.manual`). No plan limit. The space is
 * the session's; a transaction or a tag of another space is «not found» (AC7). Scoped members: «Транзакції» are closed
 * (00-general «Область доступу»).
 */
const MODULE = "transactions";

/**
 * ARC-04 FR 2: a tag change's audit entry right after the commit; a failure is no failure of the request — the job is
 * in the transactions queue and the worker writes it (`transactions.hand_off_deferred`, WARN, the error class only).
 */
async function tagAuditNow(ctx: ProtectedContext, deps: TransactionsDeps, entries: readonly TagAudit[]) {
  try {
    for (const e of entries) await deps.audit.tagChanged(ctx.principal.householdId, e);
  } catch (error) {
    logEvent("transactions.hand_off_deferred", "warn", {
      "ws.module": MODULE,
      "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
    });
  }
}

export const setAttributesRoute = defineRoute({
  module: MODULE,
  method: "PATCH",
  path: "/v1/transactions/{transactionId}/attributes",
  operationId: "setTransactionAttributes",
  summary:
    "«Зберегти» of «Нотатка» and «Теги» in the details: the fields sent change; a tag not in the space yet is created (BUD-13 FR 1, FR 2)",
  access: { permission: "household.data.write", feature: ATTRIBUTES },
  bodyLimitBytes: 32 * 1024,
  problems: ["ACCOUNT_CLOSED", "TRANSACTION_MERGED"],
  request: {
    params,
    body: z
      .object({
        /** «Нотатка»: up to 2 000 characters; null or "" removes it. */
        note: z
          .string()
          .max(NOTE_MAX * 4)
          .nullable()
          .optional(),
        /** «Теги» by name, replacing the transaction's: each up to 60 characters, at most 20 («Досягнуто 20 тегів»). */
        tags: z
          .array(z.string().max(TAG_NAME_MAX * 4))
          .max(TAGS_PER_TRANSACTION_MAX * 4)
          .optional(),
      })
      .strict(),
  },
  response: { status: 200, description: "The transaction with its attributes", schema: transactionSchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { deps } = transactionsServices(ctx);
    const result = await ctx.inHousehold((q) =>
      setAttributes(deps, transactionsTx(q), tagsTx(q), caller(ctx), params.transactionId, body),
    );
    outcome(result);
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    await handOffNow(ctx, deps, result.handOff);
    return shown(ctx, result.transaction);
  },
});

/**
 * BUD-06@PoC FR 8, AC4: the switch «Одноразова витрата» in the transaction's details. Behind the release flag and
 * feature key `transactions.one-off` (requires `transactions.manual`); no plan limit (BUD-06 «Ліміти плану»). The space
 * is the session's; a transaction of another space is «not found». Scoped members: «Транзакції» are closed.
 */
export const setOneOffRoute = defineRoute({
  module: MODULE,
  method: "PUT",
  path: "/v1/transactions/{transactionId}/one-off",
  operationId: "setTransactionOneOff",
  summary:
    "«Одноразова витрата» on or off: a marked expense stays in the fact of its period, but leaves the averages, the budget template and «Подушка безпеки» (BUD-06 FR 8)",
  access: { permission: "household.data.write", feature: ONE_OFF },
  bodyLimitBytes: 1024,
  problems: ["ACCOUNT_CLOSED", "TRANSACTION_MERGED", "TRANSACTION_IN_TRANSFER"],
  request: {
    params,
    body: z
      .object({
        /** true — marked «Одноразова витрата» (an expense only: else 400 `oneOff: not_expense`); false — not. */
        oneOff: z.boolean(),
      })
      .strict(),
  },
  response: { status: 200, description: "The transaction with its mark", schema: transactionSchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { deps } = transactionsServices(ctx);
    const result = await ctx.inHousehold((q) =>
      setOneOff(deps, transactionsTx(q), caller(ctx), params.transactionId, body.oneOff),
    );
    outcome(result);
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    await handOffNow(ctx, deps, result.handOff);
    return shown(ctx, result.transaction);
  },
});

const tagSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** AC6: how many transactions carry it (hidden ones too) — «Тег буде знято з N транзакцій». */
  count: z.number().int(),
});

export const listTagsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/transaction-tags",
  operationId: "listTransactionTags",
  summary:
    "The space's tags by name with how many transactions carry each; none — «Тегів ще немає» (BUD-13 FR 2)",
  access: { permission: "household.data.read", feature: ATTRIBUTES },
  response: {
    status: 200,
    description: "The tags",
    schema: z.object({ items: z.array(tagSchema) }),
  },
  handler: async (_input, ctx) => {
    refuseScoped(ctx);
    transactionsServices(ctx);
    const items = await ctx.inHousehold((q) => tagsWithCounts(q, ctx.principal.householdId));
    return { items };
  },
});

const tagParams = z.object({ tagId: z.uuid() });

/** The unique index of a tag's key in its space (migrations/0007_attributes.sql). */
const TAG_KEY_UNIQUE = "tags_household_id_name_key_key";

/**
 * FR 2: a rename onto a name that another request gave a tag meanwhile (a new tag of a transaction, or another rename)
 * meets the unique index of the key. Its transaction is rolled back whole; tried again, the name is there and the two
 * tags are merged, as a rename onto an existing name is.
 */
async function renameRetried<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const pg = error as { code?: string; constraint?: string };
      if (attempt >= 3 || pg.code !== "23505" || pg.constraint !== TAG_KEY_UNIQUE) throw error;
    }
  }
}

export const renameTagRoute = defineRoute({
  module: MODULE,
  method: "PATCH",
  path: "/v1/transaction-tags/{tagId}",
  operationId: "renameTransactionTag",
  summary:
    "«Перейменувати» a tag; onto the name of another tag of the space (without regard to case) the two are merged and that one is returned (BUD-13 FR 2)",
  access: { permission: "household.data.write", feature: ATTRIBUTES },
  bodyLimitBytes: 4 * 1024,
  request: {
    params: tagParams,
    body: z.object({ name: z.string().max(TAG_NAME_MAX * 4) }).strict(),
  },
  response: { status: 200, description: "The tag after the change", schema: tagSchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { deps } = transactionsServices(ctx);
    const result = await renameRetried(() =>
      ctx.inHousehold((q) => renameTag(tagsTx(q), caller(ctx), params.tagId, body.name)),
    );
    if (result.kind === "invalid") throw invalid(result.issues);
    if (result.kind === "not-found") throw new ApiProblem("NOT_FOUND");
    await tagAuditNow(ctx, deps, result.audit);
    const all = await ctx.inHousehold((q) => tagsWithCounts(q, ctx.principal.householdId));
    const tag = all.find((t) => t.id === result.tag.id);
    if (!tag) throw new ApiProblem("NOT_FOUND");
    return tag;
  },
});

export const deleteTagRoute = defineRoute({
  module: MODULE,
  method: "DELETE",
  path: "/v1/transaction-tags/{tagId}",
  operationId: "deleteTransactionTag",
  summary: "«Видалити тег» after the confirmation: the tag is taken off every transaction (BUD-13 FR 2, AC6)",
  access: { permission: "household.data.write", feature: ATTRIBUTES },
  request: { params: tagParams },
  response: {
    status: 200,
    description: "Deleted, with how many transactions it was taken off",
    schema: z.object({ deleted: z.literal(true), removed: z.number().int() }),
  },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const { deps } = transactionsServices(ctx);
    const result = await ctx.inHousehold((q) => deleteTag(tagsTx(q), caller(ctx), params.tagId));
    if (result.kind === "not-found") throw new ApiProblem("NOT_FOUND");
    await tagAuditNow(ctx, deps, [result.audit]);
    return { deleted: true as const, removed: result.removed };
  },
});

/** The selection panel holds at most as many as a bulk action takes (DAT-03 FR 7, NFR-15 FR 17). */
const SELECTION_MAX = 500;

export const selectionSummaryRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/transactions/selection-summary",
  operationId: "summarizeTransactionSelection",
  summary:
    "«Вибрано N · Сума ±X €» of the selection panel: the exact sum in the profile currency at the official rate of each transaction's date (BUD-13 FR 9)",
  access: { permission: "household.data.read", feature: FEATURE },
  bodyLimitBytes: 32 * 1024,
  request: {
    body: z.object({ ids: z.array(z.uuid()).min(1).max(SELECTION_MAX) }).strict(),
  },
  response: {
    status: 200,
    description:
      "Transactions outside the caller's space are left out without a word; «приблизно» and «N транзакцій за найближчим курсом» when a rate of the date is missing",
    schema: z.object({
      /** N of «Вибрано N»: the selected transactions of the space. */
      count: z.number().int(),
      /** The profile currency. */
      currency: z.string(),
      /** The sum, unrounded (null only when no transaction has a rate at all). */
      sum: z.object({ amount: z.string(), currency: z.string() }).nullable(),
      /** «N транзакцій конвертовано»: how many were in another currency. */
      convertedCount: z.number().int(),
      approximate: z.boolean(),
      nearestRateCount: z.number().int(),
      noRateCount: z.number().int(),
    }),
  },
  handler: async ({ body }, ctx) => {
    refuseScoped(ctx);
    const { totals, reportingCurrency } = transactionsServices(ctx);
    const groups = await ctx.inHousehold((q) =>
      selectionGroups(q, ctx.principal.householdId, [...new Set(body.ids)]),
    );
    const total = await totals.total(groups, reportingCurrency);
    return {
      count: groups.reduce((n, g) => n + g.count, 0),
      currency: reportingCurrency,
      sum: total.total === null ? null : total.total.toJSON(),
      convertedCount: groups.filter((g) => g.currency !== reportingCurrency).reduce((n, g) => n + g.count, 0),
      approximate: total.approximate,
      nearestRateCount: total.nearestRateCount,
      noRateCount: total.noRateCount,
    };
  },
});

export const attributesRoutes = [
  setAttributesRoute,
  setOneOffRoute,
  listTagsRoute,
  renameTagRoute,
  deleteTagRoute,
  selectionSummaryRoute,
];
