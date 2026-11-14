import type { Money } from "@willowsum/domain-kernel";
import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import { accountView, createAccount, findDuplicate, type AccountView } from "../../application/index.ts";
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
import { accountsTx } from "../db/store.ts";
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
  source: z.enum(ACCOUNT_SOURCES).meta({ "x-extensible-enum": true }),
  openedOn: z.string(),
  owners: z.array(ownerSchema),
  /** Per currency: today's balance from the ledger in the subaccount's currency; a debt is negative. */
  currencies: z.array(z.object({ currency: z.string(), balance: moneySchema, balanceDate: z.string() })),
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
const maybeMoney = (m: Money | null) => (m === null ? null : m.toJSON());

function present(v: AccountView): z.input<typeof accountSchema> {
  return {
    ...v,
    owners: [...v.owners],
    currencies: v.currencies.map((c) => ({ ...c, balance: money(c.balance) })),
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

export const accountsRoutes = [createAccountRoute, findDuplicateAccountRoute, getAccountRoute];
