import { Money } from "@willowsum/domain-kernel";
import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import type { AmountGroup } from "../../../../platform/lists/list-engine.ts";
import type { ListTotal } from "../../../../platform/lists/list-total.ts";
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
  type StoredTransaction,
  type TransactionResult,
} from "../../application/index.ts";
import {
  COUNTERPARTY_MAX,
  DESCRIPTION_MAX,
  TRANSACTION_SOURCES,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  typeOf,
  type FieldIssue,
} from "../../domain/index.ts";
import { transactionsList, transactionsTx } from "../db/store.ts";
import { transactionsServices } from "./services.ts";

/**
 * Transactions entered by hand (FIN-03@PoC FR 1–3, FR 13, FR 16, FR 20, FR 22, FR 29, edge case 2; wave 2 row 15):
 * create, read, change and delete, each through the journal, and the list «Транзакції» on the universal list engine
 * (DAT-01). The space is the session's (П-5): a transaction or an account of another space is «not found». A scoped
 * member: «Транзакції» are closed by the visibility policy's default (00-general «Область доступу») — not found on
 * reads, and changes need `household.data.write`, which a scoped member never has. Behind the release flag
 * `transactions.manual` (ships off) under the feature key of the same name; no plan limit.
 */
const MODULE = "transactions";
const FEATURE = "transactions.manual";

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const moneyInput = z
  .object({
    /** Signed: plus — «надходження», minus — «списання»; at most the currency's minor units; not 0. */
    amount: z.string().max(48).meta({ description: "A signed plain decimal, e.g. -45.50" }),
    currency: z
      .string()
      .max(10)
      .meta({ description: "ISO 4217 code; the account's (subaccount's) currency" }),
  })
  .strict();
const isoDate = z.string().max(10).meta({ description: "YYYY-MM-DD; never after today" });
const optionalText = (max: number) =>
  z
    .string()
    .max(max * 4)
    .nullable()
    .optional();

const transactionSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  /** Signed, in the account's currency (FR 2). */
  amount: moneySchema,
  /** FR 3: «надходження» is income, «списання» an expense. */
  type: z.enum(TRANSACTION_TYPES),
  date: z.string(),
  counterparty: z.string().nullable(),
  description: z.string().nullable(),
  status: z.enum(TRANSACTION_STATUSES).meta({ "x-extensible-enum": true }),
  source: z.enum(TRANSACTION_SOURCES).meta({ "x-extensible-enum": true }),
  /** «Дата і час»: when it was recorded (ISO 8601 UTC); the form has a date only. */
  recordedAt: z.string(),
});

function present(t: StoredTransaction): z.input<typeof transactionSchema> {
  return {
    id: t.id,
    accountId: t.accountId,
    amount: t.amount.toJSON(),
    type: typeOf(t.amount),
    date: t.date,
    counterparty: t.counterparty,
    description: t.description,
    status: t.status,
    source: t.source,
    recordedAt: t.createdAt,
  };
}

/** Where the form is wrong: the field and an issue code, never the value sent. */
function invalid(issues: readonly FieldIssue[]): ApiProblem {
  return new ApiProblem("VALIDATION_FAILED", {
    errors: issues.map((i) => ({ in: "body" as const, path: i.field, issue: i.issue })),
  });
}

function outcome(result: TransactionResult | { readonly kind: "ok" }): void {
  switch (result.kind) {
    case "invalid":
      throw invalid(result.issues);
    case "closed":
      throw new ApiProblem("ACCOUNT_CLOSED");
    case "not-found":
      throw new ApiProblem("NOT_FOUND");
  }
}

/** Scoped members: «Транзакції» are closed by the visibility policy's default (00-general «Область доступу»). */
function refuseScoped(ctx: { principal: { scoped: boolean } }): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

const caller = (ctx: { principal: { householdId: string; userId: string } }) => ({
  householdId: ctx.principal.householdId,
  accountId: ctx.principal.userId,
});

const params = z.object({ transactionId: z.uuid() });

export const createTransactionRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/transactions",
  operationId: "createTransaction",
  summary:
    "«Нова транзакція»: a transaction entered by hand, one journal event; the balance is recounted at once",
  access: { permission: "household.data.write", feature: FEATURE },
  create: true,
  bodyLimitBytes: 16 * 1024,
  problems: ["ACCOUNT_CLOSED"],
  request: {
    body: z
      .object({
        /** «Рахунок*» (FR 32). */
        accountId: z.uuid(),
        /** «Сума*» with the currency of the account (FR 2; edge case 2: another currency is refused). */
        amount: moneyInput,
        /** «Дата*» (FR 29). */
        date: isoDate,
        /** «Контрагент»: one line, up to 200 characters. */
        counterparty: optionalText(COUNTERPARTY_MAX),
        /** «Опис»: up to 1 000 characters. */
        description: optionalText(DESCRIPTION_MAX),
      })
      .strict(),
  },
  response: { status: 201, description: "The new transaction", schema: transactionSchema },
  handler: async ({ body }, ctx) => {
    const { deps } = transactionsServices(ctx);
    const result = await ctx.inHousehold((q) =>
      createTransaction(deps, transactionsTx(q), caller(ctx), body),
    );
    outcome(result);
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    return present(result.transaction);
  },
});

export const getTransactionRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/transactions/{transactionId}",
  operationId: "getTransaction",
  summary: "One transaction; another space's transaction is not found",
  access: { permission: "household.data.read", feature: FEATURE },
  request: { params },
  response: { status: 200, description: "The transaction", schema: transactionSchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    // Wired like every route of the module (src/api.ts): without the module's services it answers 500.
    transactionsServices(ctx);
    const row = await ctx.inHousehold((q) =>
      transactionsTx(q).find(ctx.principal.householdId, params.transactionId),
    );
    if (!row) throw new ApiProblem("NOT_FOUND");
    return present(row);
  },
});

export const updateTransactionRoute = defineRoute({
  module: MODULE,
  method: "PATCH",
  path: "/v1/transactions/{transactionId}",
  operationId: "updateTransaction",
  summary:
    "«Зберегти» of the edit form: the fields sent change; the account, amount or date correct the journal event",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 16 * 1024,
  problems: ["ACCOUNT_CLOSED"],
  request: {
    params,
    body: z
      .object({
        accountId: z.uuid().optional(),
        amount: moneyInput.optional(),
        date: isoDate.optional(),
        /** null or "" removes it. */
        counterparty: optionalText(COUNTERPARTY_MAX),
        description: optionalText(DESCRIPTION_MAX),
      })
      .strict(),
  },
  response: { status: 200, description: "The transaction after the change", schema: transactionSchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { deps } = transactionsServices(ctx);
    const result = await ctx.inHousehold((q) =>
      updateTransaction(deps, transactionsTx(q), caller(ctx), params.transactionId, body),
    );
    outcome(result);
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    return present(result.transaction);
  },
});

export const deleteTransactionRoute = defineRoute({
  module: MODULE,
  method: "DELETE",
  path: "/v1/transactions/{transactionId}",
  operationId: "deleteTransaction",
  summary:
    "«Видалити» a transaction entered by hand: its postings are reversed, the balance is as before (FR 16)",
  access: { permission: "household.data.write", feature: FEATURE },
  problems: ["ACCOUNT_CLOSED"],
  request: { params },
  response: {
    status: 200,
    description: "Deleted",
    schema: z.object({ deleted: z.literal(true) }),
  },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const { deps } = transactionsServices(ctx);
    const result = await ctx.inHousehold((q) =>
      deleteTransaction(deps, transactionsTx(q), caller(ctx), params.transactionId),
    );
    outcome(result);
    return { deleted: true as const };
  },
});

/** One total of the list in the profile currency (DAT-01 FR 12): unrounded; null only when no record has a rate. */
const totalSchema = z.object({
  total: moneySchema.nullable(),
  /** «конвертовано»: some amount was in another currency. */
  converted: z.boolean(),
  /** «приблизно»: some transaction was converted at the nearest earlier rate. */
  approximate: z.boolean(),
  nearestRateCount: z.number().int(),
  /** «без N записів: немає курсу». */
  partial: z.boolean(),
  noRateCount: z.number().int(),
});

const totalOut = (t: ListTotal): z.input<typeof totalSchema> => ({
  total: t.total === null ? null : t.total.toJSON(),
  converted: t.converted,
  approximate: t.approximate,
  nearestRateCount: t.nearestRateCount,
  partial: t.partial,
  noRateCount: t.noRateCount,
});

/** The driver gives a `date` as local midnight and a `timestamptz` as an instant. */
function dateText(value: unknown): string {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value);
}

function listItem(row: Record<string, unknown>): z.input<typeof transactionSchema> {
  const amount = Money.of(String(row["amount"]), String(row["currency"]));
  const recorded = row["createdAt"];
  return {
    id: String(row["id"]),
    accountId: String(row["accountId"]),
    amount: amount.toJSON(),
    type: typeOf(amount),
    date: dateText(row["date"]),
    counterparty: (row["counterparty"] as string | null) ?? null,
    description: (row["description"] as string | null) ?? null,
    status: row["status"] as StoredTransaction["status"],
    source: row["source"] as StoredTransaction["source"],
    recordedAt: recorded instanceof Date ? recorded.toISOString() : String(recorded),
  };
}

/**
 * «Дата і час» (FR 13, AC13) is the date and, under it, the time: within one date the newer record comes first, so
 * the date sort (and the default, no sort) carries the record time as its second key in the same direction.
 */
function dateAndTime(sort: string | undefined): string {
  if (sort === undefined || sort === "" || sort === "-date") return "-date,-recordedAt";
  if (sort === "date") return "date,recordedAt";
  return sort;
}

export const listTransactionsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/transactions",
  operationId: "listTransactions",
  summary:
    "«Транзакції»: one numbered page, the count, and the totals of income, expenses and their difference in the profile currency",
  access: { permission: "household.data.read", feature: FEATURE },
  request: { query: z.object({ ...transactionsList.query }) },
  response: {
    status: 200,
    description:
      "«Рядків на сторінці N · from–to з count»; totals at the official rate of each transaction's date (DAT-01 FR 12)",
    schema: z.object({
      items: z.array(transactionSchema),
      page: z.number().int(),
      pageSize: z.number().int(),
      /** Matching transactions (M of «1–N з M»). */
      count: z.number().int(),
      from: z.number().int(),
      to: z.number().int(),
      /** The totals row (FR 13): the key is not `totals`, whose numbers the money lint rule (NFR-06) would read as amounts. */
      summary: z.object({
        /** The profile currency. */
        currency: z.string(),
        income: totalSchema,
        expense: totalSchema,
        /** Income plus expenses (the expenses are negative). */
        difference: totalSchema,
      }),
    }),
  },
  handler: async ({ query }, ctx) => {
    refuseScoped(ctx);
    const { totals, reportingCurrency } = transactionsServices(ctx);
    const page = await ctx.inHousehold((q) =>
      transactionsList.run(q, { ...query, sort: dateAndTime(query.sort) }),
    );
    const of = (sign: AmountGroup["sign"]) => page.groups.filter((g) => g.sign === sign);
    const [income, expense, difference] = await Promise.all([
      totals.total(of("in"), reportingCurrency),
      totals.total(of("out"), reportingCurrency),
      totals.total(page.groups, reportingCurrency),
    ]);
    return {
      items: page.items.map(listItem),
      page: page.page,
      pageSize: page.pageSize,
      count: page.count,
      from: page.from,
      to: page.to,
      summary: {
        currency: reportingCurrency,
        income: totalOut(income),
        expense: totalOut(expense),
        difference: totalOut(difference),
      },
    };
  },
});

export const transactionsRoutes = [
  createTransactionRoute,
  listTransactionsRoute,
  getTransactionRoute,
  updateTransactionRoute,
  deleteTransactionRoute,
];
