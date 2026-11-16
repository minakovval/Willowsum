import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import {
  checkReferences,
  confirmProposal,
  createPayment,
  type Decisions,
  GONE,
  listProposals,
  nextPaymentDate,
  rejectProposal,
  type Proposal,
  type StoredPayment,
} from "../../application/index.ts";
import {
  checkPayment,
  FREQUENCIES,
  NAME_MAX,
  PAYMENT_TYPES,
  type PaymentFields,
  type PaymentInput,
  type PaymentIssue,
} from "../../domain/index.ts";
import { recurringTx } from "../db/store.ts";
import { handOffNow, recurringServices } from "./services.ts";

/**
 * Regular payments on the page «Регулярні платежі» (BUD-07@PoC FR 1–6; wave 2 row 25, the server): the proposals found
 * in the space's last 430 days of transactions (FR 1–3; a series with an old latest charge is not proposed, FR 2), a
 * proposal confirmed with edits or rejected «Не регулярний» (FR 4), a payment added by hand (FR 6), and the payments.
 * The space is the session's (П-5): another space's records are «not found». A scoped member: «Транзакції», which the
 * proposals are made of, are closed by the visibility policy's default — not found on reads; changes need
 * `household.data.write`. Behind the release flag `recurring.payments` (ships off) under the feature key of the same
 * name; no plan limit (BUD-07 «Ліміти плану»: no plans in this release).
 */
const MODULE = "recurring";
const FEATURE = "recurring.payments";
const BODY_LIMIT = 4 * 1024;

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const moneyInput = z
  .object({
    amount: z
      .string()
      .max(48)
      .meta({ description: "A plain positive decimal, at most the currency's minor units" }),
    currency: z.string().max(10).meta({ description: "ISO 4217 code" }),
  })
  .strict();
const isoDate = z.string().max(10).meta({ description: "YYYY-MM-DD" });

const proposalSchema = z.object({
  /** The series' key: stable while its first charge is in the analysed window. */
  key: z.string(),
  /** FR 1: the merchant — the one the counterparty shows (module merchants, merges included). */
  merchant: z.object({ id: z.uuid(), name: z.string() }),
  /** FR 6 «тип»: «витрата» (expense) or «дохід» (income). */
  type: z.enum(PAYMENT_TYPES),
  /** FR 2: «тиждень, 2 тижні, місяць, квартал, рік». */
  frequency: z.enum(FREQUENCIES),
  /** FR 3: «змінна» — expected amount = the average of the last 3 charges. */
  variable: z.boolean(),
  /** FR 4 «очікувану суму»: positive; the type gives its direction. */
  expectedAmount: moneySchema,
  /** FR 4 «дату»: the next date of the schedule anchored at the latest charge (`YYYY-MM-DD`, on or after today). */
  nextDate: z.string(),
  /** FR 6 «дата прив'язки» a confirmation takes by default: the charge the schedule is counted from. */
  anchorDate: z.string(),
  /** The latest charge's date. */
  lastDate: z.string(),
  /** The account of the latest charge («рахунок списання»). */
  accountId: z.uuid(),
  /** The charges of the series, oldest first. */
  transactionIds: z.array(z.uuid()),
});

const presentProposal = (p: Proposal): z.input<typeof proposalSchema> => ({
  key: p.key,
  merchant: p.merchant,
  type: p.type,
  frequency: p.frequency,
  variable: p.variable,
  expectedAmount: p.expectedAmount.toJSON(),
  nextDate: p.nextDate,
  anchorDate: p.anchorDate,
  lastDate: p.lastDate,
  accountId: p.accountId,
  transactionIds: [...p.transactionIds],
});

/** FR 6: the fields of a payment; on a confirmation each is optional and the proposal's value is the default. */
const paymentFields = {
  name: z.string().max(NAME_MAX * 4),
  /** The expected amount, positive; `type` gives its direction. */
  amount: moneyInput,
  frequency: z.enum(FREQUENCIES),
  /** «Дата прив'язки»: the schedule is counted from it; a day the month lacks is its last day. */
  anchorDate: isoDate,
  /** A category of the space's tree of the payment's type. */
  categoryId: z.uuid().nullable().optional(),
  /** «Рахунок списання»: an account of the space, not closed, not a «Кредит» (FR 16). */
  accountId: z.uuid().nullable().optional(),
  /** «Дата завершення»: not before the anchor date. */
  endDate: isoDate.nullable().optional(),
  type: z.enum(PAYMENT_TYPES),
  /** «Підписка». */
  subscription: z.boolean().optional(),
  /** «Змінна сума». */
  variable: z.boolean().optional(),
};

const paymentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(PAYMENT_TYPES),
  frequency: z.enum(FREQUENCIES),
  expectedAmount: moneySchema,
  anchorDate: z.string(),
  /** The next date of the schedule on or after today; null once the end date has passed. */
  nextDate: z.string().nullable(),
  endDate: z.string().nullable(),
  categoryId: z.uuid().nullable(),
  accountId: z.uuid().nullable(),
  subscription: z.boolean(),
  variable: z.boolean(),
  /** The merchant of the confirmed proposal; null for a payment added by hand. */
  merchantId: z.uuid().nullable(),
  /** `proposal` — a confirmed proposal (FR 4); `manual` — «Додати вручну» (FR 6). */
  source: z.enum(["proposal", "manual"]),
  createdOn: z.string(),
  version: z.number().int(),
});

const presentPayment = (p: StoredPayment, today: string): z.input<typeof paymentSchema> => ({
  id: p.id,
  name: p.name,
  type: p.type,
  frequency: p.frequency,
  expectedAmount: p.expected.toJSON(),
  anchorDate: p.anchorDate,
  nextDate: nextPaymentDate(p, today),
  endDate: p.endDate,
  categoryId: p.categoryId,
  accountId: p.accountId,
  subscription: p.subscription,
  variable: p.variable,
  merchantId: p.merchantId,
  source: p.source,
  createdOn: p.createdOn,
  version: p.version,
});

const rejectionSchema = z.object({
  id: z.uuid(),
  merchantId: z.uuid(),
  type: z.enum(PAYMENT_TYPES),
  frequency: z.enum(FREQUENCIES),
  variable: z.boolean(),
  expectedAmount: moneySchema,
  /** The charges of the rejected series: while any of them is analysed, the series is never proposed again. */
  transactionIds: z.array(z.uuid()),
  createdOn: z.string(),
});

/** Scoped members: «Транзакції» are closed by the visibility policy's default (00-general «Область доступу»). */
function refuseScoped(ctx: { principal: { scoped: boolean } }): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

const caller = (ctx: ProtectedContext) => ({
  householdId: ctx.principal.householdId,
  accountId: ctx.principal.userId,
});

function invalid(issues: readonly PaymentIssue[]): never {
  throw new ApiProblem("VALIDATION_FAILED", {
    errors: issues.map((i) => ({ in: "body" as const, path: i.field, issue: i.issue })),
  });
}

/** FR 6: the fields checked, then the category and the account against the space's tree and accounts. */
async function fieldsOf(ctx: ProtectedContext, input: PaymentInput): Promise<PaymentFields> {
  const checked = checkPayment(input);
  if (checked.kind === "invalid") invalid(checked.issues);
  const { payments } = recurringServices(ctx);
  const issues = await checkReferences(payments, ctx.principal.householdId, checked.fields);
  if (issues.length > 0) invalid(issues);
  return checked.fields;
}

/** FR 1–4: the proposals offered now — the analysis filtered by the space's payments and rejected series. */
async function offered(
  ctx: ProtectedContext,
  decided?: Decisions,
): Promise<{ items: readonly Proposal[]; more: boolean }> {
  const { deps } = recurringServices(ctx);
  const householdId = ctx.principal.householdId;
  return listProposals(
    deps,
    householdId,
    decided ?? (await ctx.inHousehold((q) => recurringTx(q).decisions(householdId))),
  );
}

/**
 * A key offered now. Not offered: «не знайдено» (BUD-07 AC9, #328 item 2) when the space never decided on its merchant
 * — another space's key reads the same as an unknown one — else 409 `RECURRING_PROPOSAL_GONE` (decided or changed).
 */
async function proposalOf(ctx: ProtectedContext, key: string): Promise<Proposal> {
  const householdId = ctx.principal.householdId;
  const decided = await ctx.inHousehold((q) => recurringTx(q).decisions(householdId));
  const found = (await offered(ctx, decided)).items.find((p) => p.key === key);
  if (found) return found;
  const merchantId = key.split(":", 1)[0] ?? "";
  const known =
    decided.merchantIds.has(merchantId) || decided.rejections.some((r) => r.merchantId === merchantId);
  throw new ApiProblem(known ? "RECURRING_PROPOSAL_GONE" : "NOT_FOUND");
}

export const listRecurringProposalsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/recurring/proposals",
  operationId: "listRecurringProposals",
  summary:
    "Proposals of regular payments: series of one merchant's charges at a frequency with a fixed (± 10 %) or variable amount, from the last 430 days, still charging (BUD-07 FR 1–4)",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description:
      "The proposals by next date; analysed anew on every read, without the merchants that are payments and the rejected series",
    schema: z.object({
      items: z.array(proposalSchema),
      /** The window had more transactions than one analysis reads; the oldest ones were left out. */
      more: z.boolean(),
    }),
  },
  handler: async (_input, ctx) => {
    refuseScoped(ctx);
    const { items, more } = await offered(ctx);
    return { items: items.map(presentProposal), more };
  },
});

export const confirmRecurringProposalRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/recurring/proposals/confirm",
  operationId: "confirmRecurringProposal",
  summary:
    "Confirm a proposal as a regular payment, with any field edited (BUD-07 FR 4); its merchant gets no more proposals",
  access: { permission: "household.data.write", feature: FEATURE },
  create: true,
  bodyLimitBytes: BODY_LIMIT,
  problems: ["RECURRING_PROPOSAL_GONE"],
  request: {
    body: z
      .object({
        /** The proposal's `key` from `GET /v1/recurring/proposals`. */
        key: z.string().max(400),
        name: paymentFields.name.optional(),
        amount: moneyInput.optional(),
        frequency: paymentFields.frequency.optional(),
        anchorDate: isoDate.optional(),
        categoryId: paymentFields.categoryId,
        accountId: paymentFields.accountId,
        endDate: paymentFields.endDate,
        type: paymentFields.type.optional(),
        subscription: paymentFields.subscription,
        variable: paymentFields.variable,
      })
      .strict(),
  },
  response: { status: 201, description: "The new regular payment", schema: paymentSchema },
  handler: async ({ body }, ctx) => {
    refuseScoped(ctx);
    const { payments, audit } = recurringServices(ctx);
    const proposal = await proposalOf(ctx, body.key);
    const edits = Object.entries(body).filter(([k, v]) => k !== "key" && v !== undefined);
    const fields = await fieldsOf(ctx, {
      // The merchant's shown name, cut to the payment's 60 characters.
      name: [...proposal.merchant.name].slice(0, NAME_MAX).join(""),
      amount: proposal.expectedAmount.toJSON(),
      frequency: proposal.frequency,
      anchorDate: proposal.anchorDate,
      accountId: proposal.accountId,
      type: proposal.type,
      variable: proposal.variable,
      ...Object.fromEntries(edits),
    });
    const { result, handOffs } = await ctx.inHousehold((q) =>
      confirmProposal(payments, recurringTx(q), caller(ctx), proposal, fields),
    );
    if (result === GONE) throw new ApiProblem("RECURRING_PROPOSAL_GONE");
    await handOffNow(audit, ctx.principal.householdId, handOffs);
    return presentPayment(result, payments.today());
  },
});

export const rejectRecurringProposalRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/recurring/proposals/reject",
  operationId: "rejectRecurringProposal",
  summary: "«Не регулярний»: the series is not proposed again (BUD-07 FR 4)",
  access: { permission: "household.data.write", feature: FEATURE },
  create: true,
  bodyLimitBytes: BODY_LIMIT,
  problems: ["RECURRING_PROPOSAL_GONE"],
  request: { body: z.object({ key: z.string().max(400) }).strict() },
  response: { status: 201, description: "The rejected series", schema: rejectionSchema },
  handler: async ({ body }, ctx) => {
    refuseScoped(ctx);
    const { payments, audit } = recurringServices(ctx);
    const proposal = await proposalOf(ctx, body.key);
    const { result, handOffs } = await ctx.inHousehold((q) =>
      rejectProposal(payments, recurringTx(q), caller(ctx), proposal),
    );
    if (result === GONE) throw new ApiProblem("RECURRING_PROPOSAL_GONE");
    await handOffNow(audit, ctx.principal.householdId, handOffs);
    return {
      id: result.id,
      merchantId: result.merchantId,
      type: result.type,
      frequency: result.frequency,
      variable: result.variable,
      expectedAmount: result.expected.toJSON(),
      transactionIds: [...result.transactionIds],
      createdOn: result.createdOn,
    };
  },
});

export const createRecurringPaymentRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/recurring/payments",
  operationId: "createRecurringPayment",
  summary: "«Додати вручну»: a regular payment of the space (BUD-07 FR 6)",
  access: { permission: "household.data.write", feature: FEATURE },
  create: true,
  bodyLimitBytes: BODY_LIMIT,
  request: { body: z.object(paymentFields).strict() },
  response: { status: 201, description: "The new regular payment", schema: paymentSchema },
  handler: async ({ body }, ctx) => {
    refuseScoped(ctx);
    const { payments, audit } = recurringServices(ctx);
    const fields = await fieldsOf(ctx, body);
    const { result, handOffs } = await ctx.inHousehold((q) =>
      createPayment(payments, recurringTx(q), caller(ctx), fields),
    );
    await handOffNow(audit, ctx.principal.householdId, handOffs);
    return presentPayment(result, payments.today());
  },
});

export const listRecurringPaymentsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/recurring/payments",
  operationId: "listRecurringPayments",
  summary: "The space's regular payments, by name (BUD-07 FR 4, FR 6)",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description: "The payments by name",
    schema: z.object({ items: z.array(paymentSchema) }),
  },
  handler: async (_input, ctx) => {
    refuseScoped(ctx);
    const { payments } = recurringServices(ctx);
    const found = await ctx.inHousehold((q) => recurringTx(q).payments(ctx.principal.householdId));
    const today = payments.today();
    return { items: found.map((p) => presentPayment(p, today)) };
  },
});

export const getRecurringPaymentRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/recurring/payments/{paymentId}",
  operationId: "getRecurringPayment",
  summary: "One regular payment; another space's is not found",
  access: { permission: "household.data.read", feature: FEATURE },
  request: { params: z.object({ paymentId: z.uuid() }) },
  response: { status: 200, description: "The payment", schema: paymentSchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const { payments } = recurringServices(ctx);
    const found = await ctx.inHousehold((q) =>
      recurringTx(q).payment(ctx.principal.householdId, params.paymentId),
    );
    if (!found) throw new ApiProblem("NOT_FOUND");
    return presentPayment(found, payments.today());
  },
});

export const recurringRoutes = [
  listRecurringProposalsRoute,
  confirmRecurringProposalRoute,
  rejectRecurringProposalRoute,
  createRecurringPaymentRoute,
  listRecurringPaymentsRoute,
  getRecurringPaymentRoute,
];
