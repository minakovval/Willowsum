import type { Money } from "@willowsum/domain-kernel";
import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { decodeCursor, encodeCursor, pageOf, pageQuery } from "../../../../platform/http/pagination.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import {
  accountsPage,
  accountsSummary,
  accountView,
  closeAccount,
  closingPreview,
  createAccount,
  deleteAdjustment,
  findDuplicate,
  reopenAccount,
  updateBalance,
  type AccountListItem,
  type AdjustmentView,
  type ManageRefusal,
  type AccountView,
  type ConvertedAmount,
  type ReportedSum,
} from "../../application/index.ts";
import {
  ACCOUNT_KINDS,
  ACCOUNT_NAME_MAX,
  ACCOUNT_SOURCES,
  ACCOUNT_STATUSES,
  CURRENCIES_MAX,
  INSTITUTION_NAME_MAX,
  institutionKey,
  institutionOf,
  NOTE_MAX,
  parseAccountNumber,
  type FieldIssue,
} from "../../domain/index.ts";
import { accountsListTx, accountsTx } from "../db/store.ts";
import { accountsServices } from "./services.ts";

/**
 * Money accounts (FIN-01@PoC FR 1–8, FR 12, FR 16, FR 25; «Новий рахунок», S-052): create an account with its opening
 * balance, read one account, and the duplicate check of the form. The space is the session's (П-5): an account of
 * another space is «not found». Behind the release flag `accounts.manual` (ships off) under the feature key of the
 * same name; manual accounts have no plan limit (FIN-01 «Ліміти плану»).
 */
const MODULE = "accounts";
const FEATURE = "accounts.manual";

/** The bounds of 4 UTF-16 units per character only cap the body; the rules count code points (domain). */
const typedAmount = z
  .string()
  .max(48)
  .meta({ description: "A plain decimal, e.g. 1200.50; at most the currency's minor units" });
const currency = z.string().max(10).meta({ description: "ISO 4217 code" });
const isoDate = z.string().max(10).meta({ description: "YYYY-MM-DD" });
const optional = <T extends z.ZodType>(schema: T) => schema.nullable().optional();
const institutionInput = z
  .object({
    name: z.string().max(INSTITUTION_NAME_MAX * 4),
    country: z.string().max(2).meta({ description: "ISO 3166-1 alpha-2" }),
  })
  .strict();

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const ownerSchema = z.object({
  ownerAccountId: z.uuid(),
  share: z.string().meta({ description: "Percent, a decimal string" }),
  validFrom: z.string(),
  validTo: z.string().nullable(),
});

/** «Коригування залишку» (FIN-12 FR 14, FR 15; FIN-04 FR 11): the one adjustment of a currency of the account. */
const adjustmentSchema = z.object({
  /** The adjustment's id (the ledger entry in effect): it changes when the adjustment changes. */
  id: z.uuid(),
  /** What it adds to the balance, from the holder's side. */
  amount: moneySchema,
  date: z.string(),
  /** A manual account's adjustment is permanent; an imported one's is recounted by the next statement. */
  permanent: z.boolean(),
});

const accountSchema = z.object({
  id: z.uuid(),
  kind: z.enum(ACCOUNT_KINDS).meta({ "x-extensible-enum": true }),
  /** «Готівкові» or «Кредитні» (FIN-01 FR 14, FR 19). */
  group: z.enum(["cash", "credit"]),
  name: z.string(),
  institution: z.object({ name: z.string(), country: z.string() }).nullable(),
  /** Only the last 4 characters of the IBAN or number, never the full value (FIN-01 AC7). */
  number: z.object({ last4: z.string(), masked: z.string() }).nullable(),
  note: z.string().nullable(),
  status: z.enum(ACCOUNT_STATUSES).meta({ "x-extensible-enum": true }),
  /** The date of «Закритий» (FIN-12 FR 7, FR 8); null while active. */
  closedOn: z.string().nullable(),
  source: z.enum(ACCOUNT_SOURCES).meta({ "x-extensible-enum": true }),
  openedOn: z.string(),
  owners: z.array(ownerSchema),
  /** Per currency: today's balance from the ledger in the subaccount's currency; a debt is negative. */
  currencies: z.array(z.object({ currency: z.string(), balance: moneySchema, balanceDate: z.string() })),
  /** The adjustments of «Оновити залишок» in effect, at most one per currency (FIN-12 FR 14, FR 15). */
  adjustments: z.array(adjustmentSchema.extend({ currency: z.string() })),
  savings: z.object({ annualRate: z.string().nullable() }).nullable(),
  deposit: z
    .object({
      annualRate: z.string().nullable(),
      openedOn: z.string().nullable(),
      maturesOn: z.string().nullable(),
      /** «Нараховано (розрахунково)» (FIN-01 FR 9–11); null without a rate, an opening or a maturity date. */
      accrual: z
        .object({
          accrued: moneySchema,
          days: z.number().int(),
          daysToMaturity: z.number().int(),
          matured: z.boolean(),
        })
        .nullable(),
    })
    .nullable(),
  creditCard: z
    .object({
      annualRate: z.string().nullable(),
      creditLimit: moneySchema.nullable(),
      gracePeriodDays: z.number().int().nullable(),
      debt: moneySchema,
      /** The credit limit minus the debt (FIN-01 FR 16); null without a limit. */
      available: moneySchema.nullable(),
    })
    .nullable(),
  loan: z
    .object({ annualRate: z.string().nullable(), monthlyPayment: moneySchema.nullable(), debt: moneySchema })
    .nullable(),
});

const money = (m: Money) => m.toJSON();
const adjustmentOut = (a: AdjustmentView | null) =>
  a && { id: a.entryId, amount: money(a.amount), date: a.date, permanent: a.permanent };
const maybeMoney = (m: Money | null) => (m === null ? null : m.toJSON());

function present(v: AccountView): z.input<typeof accountSchema> {
  return {
    ...v,
    owners: [...v.owners],
    currencies: v.currencies.map((c) => ({ ...c, balance: money(c.balance) })),
    adjustments: v.adjustments.map((a) => ({ ...adjustmentOut(a)!, currency: a.currency })),
    deposit: v.deposit && {
      ...v.deposit,
      accrual: v.deposit.accrual && { ...v.deposit.accrual, accrued: money(v.deposit.accrual.accrued) },
    },
    creditCard: v.creditCard && {
      ...v.creditCard,
      creditLimit: maybeMoney(v.creditCard.creditLimit),
      debt: money(v.creditCard.debt),
      available: maybeMoney(v.creditCard.available),
    },
    loan: v.loan && {
      ...v.loan,
      monthlyPayment: maybeMoney(v.loan.monthlyPayment),
      debt: money(v.loan.debt),
    },
  };
}

/** Where the form is wrong: the field and an issue code, never the value sent. */
function invalid(issues: readonly FieldIssue[]): ApiProblem {
  return new ApiProblem("VALIDATION_FAILED", {
    errors: issues.map((i) => ({ in: "body" as const, path: i.field, issue: i.issue })),
  });
}

export const createAccountRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/accounts",
  operationId: "createAccount",
  summary: "Create a money account with its opening balance («Новий рахунок»)",
  access: { permission: "household.data.write", feature: FEATURE },
  create: true,
  // The full number is sealed (FIN-01 AC7): the stored request hash covers only its last 4 characters, which are
  // clear anyway, so the hash cannot be searched for the full IBAN.
  idempotencyHashInput: ({ body }) => {
    if (typeof body.number !== "string") return body;
    const parsed = parseAccountNumber(body.number);
    return { ...body, number: typeof parsed === "string" ? null : parsed.last4 };
  },
  bodyLimitBytes: 32 * 1024,
  problems: ["ACCOUNT_DUPLICATE"],
  request: {
    body: z
      .object({
        /** «Тип рахунку*» (FIN-01 FR 1); the form preselects «Поточний». */
        kind: z.enum(ACCOUNT_KINDS),
        /** «Назва*»: one line, 1–80 characters. */
        name: z.string().max(ACCOUNT_NAME_MAX * 4),
        /** «Банк або установа»: name and country (FR 4). */
        institution: optional(institutionInput),
        /** «Залишок*» + «Валюта*»; for a credit card and a loan «Залишок боргу*» (the debt, not negative). */
        balance: z.object({ amount: typedAmount, currency }).strict(),
        /** «На дату*» */
        balanceDate: isoDate,
        /** «+ додати ще валюту» (FR 12): a current account's further currencies, each with its balance and date. */
        extraCurrencies: optional(
          z.array(z.object({ amount: typedAmount, currency, date: isoDate }).strict()).max(CURRENCIES_MAX),
        ),
        /** «Номер · останні 4 цифри / IBAN»: the last 4 characters, or a full IBAN or account number (sealed). */
        number: optional(z.string().max(64)),
        /** «Нотатка»: up to 1 000 characters. */
        note: optional(z.string().max(NOTE_MAX * 4)),
        /** «Ощадний», «Депозит», «Кредитна картка», «Кредит» (required): percent per year, 0–100, two decimals. */
        annualRate: optional(z.string().max(10)),
        /** «Депозит» (FR 8). */
        depositOpenedOn: optional(isoDate),
        depositMaturesOn: optional(isoDate),
        /** «Кредитна картка»: «Кредитний ліміт» and «Пільговий період» (days). */
        creditLimit: optional(typedAmount),
        gracePeriodDays: optional(z.number().int().min(0).max(365)),
        /** «Кредит»: «Щомісячний платіж*», more than 0, in the account's currency. */
        monthlyPayment: optional(typedAmount),
      })
      .strict(),
  },
  response: { status: 201, description: "The new account with its balances", schema: accountSchema },
  handler: async ({ body }, ctx) => {
    const { deps } = accountsServices(ctx);
    const caller = { householdId: ctx.principal.householdId, accountId: ctx.principal.userId };
    return ctx.inHousehold(async (q) => {
      const tx = accountsTx(q);
      const result = await createAccount(deps, tx, caller, body);
      if (result.kind === "invalid") throw invalid(result.issues);
      if (result.kind === "duplicate") throw new ApiProblem("ACCOUNT_DUPLICATE");
      const view = await accountView(deps, tx, caller.householdId, result.accountId);
      if (!view) throw new ApiProblem("INTERNAL");
      return present(view);
    });
  },
});

export const getAccountRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/accounts/{accountId}",
  operationId: "getAccount",
  summary: "One money account with today's balances; another space's account is not found",
  access: { permission: "household.data.read", feature: FEATURE },
  request: { params: z.object({ accountId: z.uuid() }) },
  response: { status: 200, description: "The account", schema: accountSchema },
  handler: async ({ params }, ctx) => {
    // A scoped member: «Рахунки» are closed by the visibility policy's default (00-general «Область доступу»), and
    // the policy is not modelled yet — not found, exactly like an unknown id.
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    const { deps } = accountsServices(ctx);
    const view = await ctx.inHousehold((q) =>
      accountView(deps, accountsTx(q), ctx.principal.householdId, params.accountId),
    );
    if (!view) throw new ApiProblem("NOT_FOUND");
    return present(view);
  },
});

export const findDuplicateAccountRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/accounts/duplicate-check",
  operationId: "findDuplicateAccount",
  summary:
    "The existing account a new one would duplicate (same institution, number or IBAN and currency), or null",
  // Creating needs it, and it tells whether an account exists: the same right as creating (a scoped member who
  // only reads within a scope must not probe for accounts outside it).
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 4 * 1024,
  request: {
    body: z
      .object({
        institution: optional(institutionInput),
        number: z.string().max(64),
        currencies: z.array(currency).min(1).max(CURRENCIES_MAX),
      })
      .strict(),
  },
  response: {
    status: 200,
    description: "«Такий рахунок уже є: <установа> ••<4 символи>» with the account to open, or null",
    schema: z.object({
      duplicate: z
        .object({ accountId: z.uuid(), institution: z.string(), maskedNumber: z.string() })
        .nullable(),
    }),
  },
  handler: async ({ body }, ctx) => {
    const { deps } = accountsServices(ctx);
    const number = parseAccountNumber(body.number);
    const issues: FieldIssue[] = [];
    if (typeof number === "string") issues.push({ field: "number", issue: number });
    const institution = body.institution ? institutionOf(body.institution) : null;
    if (body.institution && !institution) issues.push({ field: "institution", issue: "invalid" });
    if (issues.length > 0 || typeof number === "string") throw invalid(issues);
    const householdId = ctx.principal.householdId;
    const duplicate = await ctx.inHousehold((q) =>
      findDuplicate(deps, accountsTx(q), householdId, {
        institutionKey: institutionKey(institution),
        number,
        currencies: body.currencies,
      }),
    );
    return { duplicate };
  },
});

/** A sum in the profile currency: unrounded; null only when no amount has any rate (never 0). */
const reportedSumSchema = z.object({
  total: moneySchema.nullable(),
  /** «приблизно»: a rate older than 3 calendar days (VAL-04), or an amount without any rate left out. */
  approximate: z.boolean(),
  /** Amounts left out for want of any rate («Курс недоступний»). */
  unavailableCount: z.number().int(),
});
const convertedSchema = z.object({
  currency: z.string(),
  /** In its own currency, as the ledger has it (a debt negative). */
  amount: moneySchema,
  /** In the profile currency; null without any rate. */
  equivalent: moneySchema.nullable(),
  /** The date of the NBU rate used; null when nothing was converted. */
  rateDate: z.string().nullable(),
  approximate: z.boolean(),
  restricted: z.boolean(),
});

const sum = (r: ReportedSum) => ({ ...r, total: maybeMoney(r.total) });
const convertedOut = (c: ConvertedAmount) => ({
  ...c,
  amount: money(c.amount),
  equivalent: maybeMoney(c.equivalent),
});

/** Scoped members: «Рахунки» are closed by the visibility policy's default (00-general «Область доступу»). */
function refuseScoped(ctx: { principal: { scoped: boolean } }): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

export const accountsSummaryRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/accounts/summary",
  operationId: "getAccountsSummary",
  summary:
    "«Гроші разом» with the breakdown by currency, the «Кредитні» header and «Джерела даних» (active accounts)",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description: "Totals in the profile currency at the dated NBU rate (fx-rates); amounts unrounded",
    schema: z.object({
      /** The profile currency. */
      currency: z.string(),
      /** FIN-01 FR 18: cash accounts minus the credit cards' debt; loans never count. */
      moneyTogether: reportedSumSchema.extend({
        staleRateCount: z.number().int(),
        /** «курс НБУ на <дата>»: the earliest rate date used; null when nothing was converted. */
        rate: z.object({ source: z.string(), date: z.string() }).nullable(),
        /** One bar segment and legend line per currency: the largest equivalent first. */
        breakdown: z.array(
          convertedSchema.extend({
            /** Whole percent of the bar (they add up to 100); null without a segment. */
            percent: z.number().int().nullable(),
          }),
        ),
      }),
      /** FIN-01 FR 19: what is owed on cards, and «Кредити: −<сума>» (both positive debts). */
      credit: z.object({ cardDebt: reportedSumSchema, loanDebt: reportedSumSchema }),
      /** FIN-01 FR 21: active accounts per source. */
      sources: z.object({ import: z.number().int(), manual: z.number().int() }),
    }),
  },
  handler: async (_request, ctx) => {
    refuseScoped(ctx);
    const { deps } = accountsServices(ctx);
    const s = await ctx.inHousehold((q) =>
      accountsSummary(deps, accountsListTx(q), ctx.principal.householdId),
    );
    return {
      currency: s.currency,
      moneyTogether: {
        ...sum(s.moneyTogether),
        staleRateCount: s.moneyTogether.staleRateCount,
        rate: s.moneyTogether.rate,
        breakdown: s.moneyTogether.breakdown.map((b) => ({ ...convertedOut(b), percent: b.percent })),
      },
      credit: { cardDebt: sum(s.credit.cardDebt), loanDebt: sum(s.credit.loanDebt) },
      sources: s.sources,
    };
  },
});

const listItemSchema = z.object({
  id: z.uuid(),
  kind: z.enum(ACCOUNT_KINDS).meta({ "x-extensible-enum": true }),
  group: z.enum(["cash", "credit"]),
  name: z.string(),
  institution: z.object({ name: z.string(), country: z.string() }).nullable(),
  number: z.object({ last4: z.string(), masked: z.string() }).nullable(),
  status: z.enum(ACCOUNT_STATUSES).meta({ "x-extensible-enum": true }),
  closedOn: z.string().nullable(),
  source: z.enum(ACCOUNT_SOURCES).meta({ "x-extensible-enum": true }),
  /** «Дата останнього оновлення»: the latest balance date of the account. */
  updatedOn: z.string(),
  /** The account in the profile currency (a debt negative); a multi-currency account is one row (FR 13). */
  inProfileCurrency: reportedSumSchema,
  /** Each subaccount in its own currency and in the profile currency. */
  currencies: z.array(convertedSchema),
  creditCard: z
    .object({ creditLimit: moneySchema.nullable(), debt: moneySchema, available: moneySchema.nullable() })
    .nullable(),
  loan: z
    .object({ annualRate: z.string().nullable(), monthlyPayment: moneySchema.nullable(), debt: moneySchema })
    .nullable(),
});

const listPosition = z.object({ i: z.uuid() }).strict();

function presentItem(item: AccountListItem): z.input<typeof listItemSchema> {
  return {
    ...item,
    inProfileCurrency: sum(item.inProfileCurrency),
    currencies: item.currencies.map(convertedOut),
    creditCard: item.creditCard && {
      creditLimit: maybeMoney(item.creditCard.creditLimit),
      debt: money(item.creditCard.debt),
      available: maybeMoney(item.creditCard.available),
    },
    loan: item.loan && {
      annualRate: item.loan.annualRate,
      monthlyPayment: maybeMoney(item.loan.monthlyPayment),
      debt: money(item.loan.debt),
    },
  };
}

export const listAccountsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/accounts",
  operationId: "listAccounts",
  summary: "The space's money accounts with today's balances, in the order they were added",
  access: { permission: "household.data.read", feature: FEATURE },
  list: true,
  request: {
    query: z.object({
      ...pageQuery.shape,
      /** «Готівкові» or «Кредитні» (FIN-01 FR 14); both when absent. */
      group: z.enum(["cash", "credit"]).optional(),
      /** «Параметри» → «Показати закриті» (FIN-01 FR 22). */
      includeClosed: z.enum(["true", "false"]).optional(),
    }),
  },
  response: { status: 200, description: "A page of accounts", schema: pageOf(listItemSchema) },
  handler: async ({ query }, ctx) => {
    refuseScoped(ctx);
    const { deps } = accountsServices(ctx);
    const after = query.cursor ? decodeCursor(query.cursor, listPosition) : null;
    const page = await ctx.inHousehold((q) =>
      accountsPage(deps, accountsListTx(q), ctx.principal.householdId, {
        group: query.group ?? null,
        includeClosed: query.includeClosed === "true",
        after: after && { id: after.i },
        limit: query.limit,
      }),
    );
    return {
      items: page.items.map(presentItem),
      nextCursor: page.next ? encodeCursor({ i: page.next.id }) : null,
    };
  },
});

/** A refusal of managing an account as the API answers it; nothing was written for any of them. */
function refusal(r: ManageRefusal): ApiProblem {
  switch (r.kind) {
    case "not-found":
      return new ApiProblem("NOT_FOUND");
    case "closed":
      return new ApiProblem("ACCOUNT_CLOSED");
    case "not-closed":
      return new ApiProblem("ACCOUNT_NOT_CLOSED");
    case "invalid":
      return invalid(r.issues);
    case "activity-after-close":
      return new ApiProblem("ACCOUNT_ACTIVITY_AFTER_CLOSE");
    case "balance-not-zero":
      return new ApiProblem("ACCOUNT_BALANCE_NOT_ZERO");
  }
}

const accountParams = z.object({ accountId: z.uuid() });

/** The account after a change, as `GET` answers it. */
async function presentAccount(
  deps: ReturnType<typeof accountsServices>["deps"],
  tx: ReturnType<typeof accountsTx>,
  householdId: string,
  accountId: string,
) {
  const view = await accountView(deps, tx, householdId, accountId);
  if (!view) throw new ApiProblem("INTERNAL");
  return present(view);
}

export const accountClosingRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/accounts/{accountId}/closing",
  operationId: "getAccountClosing",
  summary: "The closing dialog: the account's balance on the closing date per currency (FIN-12 FR 7)",
  access: { permission: "household.data.write", feature: FEATURE },
  request: { params: accountParams, query: z.object({ closedOn: isoDate }) },
  problems: ["ACCOUNT_CLOSED"],
  response: {
    status: 200,
    description: "The balances on the closing date; `zero` — the account can close without a choice",
    schema: z.object({
      closedOn: z.string(),
      zero: z.boolean(),
      currencies: z.array(z.object({ currency: z.string(), balance: moneySchema })),
    }),
  },
  handler: async ({ params, query }, ctx) => {
    refuseScoped(ctx);
    const { deps } = accountsServices(ctx);
    const result = await ctx.inHousehold((q) =>
      closingPreview(deps, accountsTx(q), ctx.principal.householdId, params.accountId, query.closedOn),
    );
    if (result.kind !== "preview") throw refusal(result);
    return {
      closedOn: query.closedOn,
      zero: result.currencies.every((c) => c.balance.isZero()),
      currencies: result.currencies.map((c) => ({ currency: c.currency, balance: money(c.balance) })),
    };
  },
});

export const closeAccountRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/accounts/{accountId}/close",
  operationId: "closeAccount",
  summary:
    "«Закрити рахунок»: with a zero balance on the closing date, after a transfer or a write-off (FIN-12 FR 7)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 4 * 1024,
  problems: ["ACCOUNT_CLOSED", "ACCOUNT_BALANCE_NOT_ZERO", "ACCOUNT_ACTIVITY_AFTER_CLOSE"],
  request: {
    params: accountParams,
    body: z
      .object({
        /** «Дата закриття»: from the opening date to today. */
        closedOn: isoDate,
        /** A balance that is not zero: «Перенести на інший рахунок» or «Списати коригуванням». */
        settlement: z
          .discriminatedUnion("kind", [
            z.object({ kind: z.literal("transfer"), toAccountId: z.uuid() }).strict(),
            z.object({ kind: z.literal("adjustment") }).strict(),
          ])
          .optional(),
      })
      .strict(),
  },
  response: { status: 200, description: "The closed account", schema: accountSchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { deps } = accountsServices(ctx);
    const caller = { householdId: ctx.principal.householdId, accountId: ctx.principal.userId };
    return ctx.inHousehold(async (q) => {
      const tx = accountsTx(q);
      const result = await closeAccount(deps, tx, caller, params.accountId, {
        closedOn: body.closedOn,
        settlement: body.settlement ?? null,
      });
      if (result.kind !== "account-closed") throw refusal(result);
      return presentAccount(deps, tx, caller.householdId, params.accountId);
    });
  },
});

export const reopenAccountRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/accounts/{accountId}/reopen",
  operationId: "reopenAccount",
  summary: "«Відкрити знову»: a closed account is active again (FIN-12 FR 9)",
  access: { permission: "household.data.write", feature: FEATURE },
  problems: ["ACCOUNT_NOT_CLOSED"],
  request: { params: accountParams },
  response: { status: 200, description: "The account, active again", schema: accountSchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const { deps } = accountsServices(ctx);
    const caller = { householdId: ctx.principal.householdId, accountId: ctx.principal.userId };
    return ctx.inHousehold(async (q) => {
      const tx = accountsTx(q);
      const result = await reopenAccount(deps, tx, caller, params.accountId);
      if (result.kind !== "reopened") throw refusal(result);
      return presentAccount(deps, tx, caller.householdId, params.accountId);
    });
  },
});

export const updateAccountBalanceRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/accounts/{accountId}/balance",
  operationId: "updateBalanceOfAccount",
  summary:
    "«Оновити залишок»: one adjustment of the difference against «Коригування», dated today (FIN-12 FR 14)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 4 * 1024,
  problems: ["ACCOUNT_CLOSED"],
  request: {
    params: accountParams,
    body: z
      .object({
        /** «Поточний залишок*» in a currency of the account; a card's and a loan's debt as a positive amount. */
        balance: z.object({ amount: typedAmount, currency }).strict(),
      })
      .strict(),
  },
  response: {
    status: 200,
    description: "The adjustment in effect and today's balance; `changed` false — the difference was zero",
    schema: z.object({
      changed: z.boolean(),
      adjustment: adjustmentSchema.nullable(),
      balance: moneySchema,
    }),
  },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { deps } = accountsServices(ctx);
    const caller = { householdId: ctx.principal.householdId, accountId: ctx.principal.userId };
    const result = await ctx.inHousehold((q) =>
      updateBalance(deps, accountsTx(q), caller, params.accountId, body.balance),
    );
    if (result.kind !== "updated") throw refusal(result);
    return {
      changed: result.changed,
      adjustment: adjustmentOut(result.adjustment),
      balance: money(result.balance),
    };
  },
});

export const deleteBalanceAdjustmentRoute = defineRoute({
  module: MODULE,
  method: "DELETE",
  path: "/v1/accounts/{accountId}/balance-adjustments/{adjustmentId}",
  operationId: "deleteBalanceAdjustment",
  summary:
    "Deletes the adjustment of «Оновити залишок»: its reversal brings the previous balance back (FIN-04 FR 11)",
  access: { permission: "household.data.write", feature: FEATURE },
  problems: ["ACCOUNT_CLOSED"],
  request: { params: z.object({ accountId: z.uuid(), adjustmentId: z.uuid() }) },
  response: {
    status: 200,
    description: "Today's balance of the adjustment's currency",
    schema: z.object({ balance: moneySchema }),
  },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const { deps } = accountsServices(ctx);
    const caller = { householdId: ctx.principal.householdId, accountId: ctx.principal.userId };
    const result = await ctx.inHousehold((q) =>
      deleteAdjustment(deps, accountsTx(q), caller, params.accountId, params.adjustmentId),
    );
    if (result.kind !== "deleted") throw refusal(result);
    return { balance: money(result.balance) };
  },
});

export const accountsRoutes = [
  createAccountRoute,
  findDuplicateAccountRoute,
  accountsSummaryRoute,
  listAccountsRoute,
  getAccountRoute,
  accountClosingRoute,
  closeAccountRoute,
  reopenAccountRoute,
  updateAccountBalanceRoute,
  deleteBalanceAdjustmentRoute,
];
