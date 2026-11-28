import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import {
  listCounterparts,
  listProposals,
  PAIR_LIST_MAX,
  searchPairsAgain,
  type ConfirmedPair,
  type OneSidedSide,
} from "../../application/index.ts";
import type { ChosenProposal, Counterpart, TransferSide } from "../../domain/index.ts";
import { transferMatchingServices } from "./services.ts";

/**
 * «Пари · N» of the page «Транзакції» (FIN-03@PoC FR 5, FR 6, AC2, AC4; wave 2 row 16b): the proposals of transfers
 * between own accounts. The space is the session's (П-5). A scoped member: «Транзакції» are closed by the visibility
 * policy's default — not found. Behind the release flag and feature key `transactions.transfers` (requires
 * `transactions.manual`); no plan limit.
 */
const MODULE = "transfer-matching";
const FEATURE = "transactions.transfers";

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const sideSchema = z.object({
  transactionId: z.uuid(),
  accountId: z.uuid(),
  /** Signed: the outflow negative, the inflow positive, each in its account's currency. */
  amount: moneySchema,
  date: z.string(),
});

const proposalSchema = z.object({
  outflow: sideSchema,
  inflow: sideSchema,
  /** Edge case 1: the earlier side's date. */
  date: z.string(),
  /**
   * IMP-03@PoC FR 2: «переказ між власними рахунками» (two accounts) or «обмін валют» (two wallets of one
   * multi-currency account in two currencies).
   */
  pairKind: z.enum(["transfer", "exchange"]).meta({ "x-extensible-enum": true }),
  /** One currency, or two (a currency transfer, FR 5). */
  kind: z.enum(["same-currency", "cross-currency"]).meta({ "x-extensible-enum": true }),
  /** One currency: the difference, «Комісії банку» once confirmed (FR 8; negative or 0); else null. */
  fee: moneySchema.nullable(),
  /** Two currencies: 1 unit of the outflow's currency in the inflow's, the official rate of the date (or earlier). */
  rate: z.object({ rate: z.string(), date: z.string(), source: z.string() }).nullable(),
  /** Two currencies: the debit at the rate, in the inflow's currency (unrounded). */
  converted: moneySchema.nullable(),
  /** Two currencies: the credit less `converted` (unrounded). */
  difference: moneySchema.nullable(),
  /**
   * IMP-03@PoC FR 21: two currencies — the bank's rate, the actual rate of the pair (credit ÷ debit: 1 unit of the
   * outflow's currency in the inflow's, 18 decimals), next to the reference `rate`; one currency — null.
   */
  bankRate: z.string().nullable(),
  /** IMP-03@PoC FR 4: two currencies — the bank's rate within 1 % or within 3 % of the reference; one currency — null. */
  rateBand: z.enum(["within-1", "within-3"]).meta({ "x-extensible-enum": true }).nullable(),
  /** IMP-03@PoC FR 3: the score 0–100, the sum of the evidence's points; a proposal has at least 55. */
  score: z.number().int().min(0).max(100),
  /** IMP-03@PoC FR 3: high from 80, medium from 65, else low. */
  confidence: z.enum(["high", "medium", "low"]),
  /** IMP-03@PoC FR 4, FR 17: «чому ці операції» — the evidence and its points. */
  evidence: z.array(
    z.object({
      code: z
        .enum([
          "exact-amount",
          "amount-less-fee",
          "rate-within-1",
          "rate-within-3",
          "same-day",
          "days-apart",
          "same-wallet-group",
        ])
        .meta({ "x-extensible-enum": true }),
      points: z.number().int(),
      /** `days-apart`: the days between the sides; else null. */
      days: z.number().int().nullable(),
    }),
  ),
  /**
   * IMP-03@PoC FR 7: «неоднозначно з…» — other candidates within 5 points that share a side with this pair (the
   * transaction that would take the other side, and that pair's score), best first; empty when none.
   */
  ambiguousWith: z.array(z.object({ transactionId: z.uuid(), score: z.number().int() })),
});

const side = (s: TransferSide): z.input<typeof sideSchema> => ({
  transactionId: s.transactionId,
  accountId: s.accountId,
  amount: s.amount.toJSON(),
  date: s.date,
});

function present(p: ChosenProposal): z.input<typeof proposalSchema> {
  const cross = p.kind === "cross-currency" ? p : null;
  return {
    outflow: side(p.outflow),
    inflow: side(p.inflow),
    date: p.date,
    pairKind: p.pairKind,
    kind: p.kind,
    fee: p.kind === "same-currency" ? p.fee.toJSON() : null,
    rate: cross && { rate: cross.rate.rate.toString(), date: cross.rate.date, source: cross.rate.source },
    converted: cross?.converted.toJSON() ?? null,
    difference: cross?.difference.toJSON() ?? null,
    bankRate: cross?.bankRate.toFixed() ?? null,
    rateBand: cross?.rateBand ?? null,
    score: p.score,
    confidence: p.confidence,
    evidence: p.evidence.map((e) => ({ code: e.code, points: e.points, days: e.days ?? null })),
    ambiguousWith: p.ambiguousWith.map((a) => ({ transactionId: a.transactionId, score: a.score })),
  };
}

export const listTransferProposalsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/transfer-proposals",
  operationId: "listTransferProposals",
  summary:
    "«Пари · N»: pairs of a debit and a credit on two own accounts (or two wallets of one account in two currencies — an exchange) within 3 days that look like one transfer, scored 0–100 (at least 55) and one-to-one; the system never marks them itself",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description:
      "The proposals, newest first; «Підтвердити» is POST /v1/transactions/{outflow}/transfer with the inflow, «Не пара» POST /v1/transactions/{outflow}/not-transfer with the inflow",
    schema: z.object({
      items: z.array(proposalSchema),
      /** N of «Пари · N». */
      count: z.number().int(),
      /** The search looked at its most candidate pairs; older ones come once these are decided. */
      more: z.boolean(),
    }),
  },
  handler: async (_input, ctx) => {
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    const { deps } = transferMatchingServices(ctx);
    const { proposals, more } = await listProposals(deps, ctx.principal.householdId);
    return { items: proposals.map(present), count: proposals.length, more };
  },
});

const counterpartSchema = sideSchema.extend({
  /** «Опис» of the row: the counterparty and the description as typed or imported; null — none. */
  counterparty: z.string().nullable(),
  description: z.string().nullable(),
  /** The chosen transaction's currency, or another (a currency transfer or an exchange). */
  kind: z.enum(["same-currency", "cross-currency"]).meta({ "x-extensible-enum": true }),
  /**
   * One currency: the credit plus the debit — negative or zero, the fee that becomes an expense «Комісії банку» once
   * paired (FR 24, FR 9); never positive, as a credit above the debit is no candidate. Two currencies: the credit less the
   * debit at the reference `rate` (FR 21, unrounded), null without a rate.
   */
  difference: moneySchema.nullable(),
  /** «Поєднати в пару» (`POST /v1/transactions/{id}/transfer`) accepts the pair; false — it answers `amount_mismatch` (one currency) or `rate_unavailable` (two, no reference rate). */
  markable: z.boolean(),
  /** Two currencies: the reference rate, 1 unit of the debit's currency in the credit's; else, or none known, null. */
  rate: z.object({ rate: z.string(), date: z.string(), source: z.string() }).nullable(),
  /** Two currencies: the debit at `rate`, in the credit's currency (unrounded); else null. */
  converted: moneySchema.nullable(),
  /** FR 21: two currencies — the pair's rate (credit ÷ debit, 18 decimals) next to the reference; else null. */
  bankRate: z.string().nullable(),
});

function counterpart(c: Counterpart): z.input<typeof counterpartSchema> {
  const cross = c.kind === "cross-currency" ? c : null;
  return {
    ...side(c),
    counterparty: c.counterparty,
    description: c.description,
    kind: c.kind,
    difference: c.difference?.toJSON() ?? null,
    markable: c.markable,
    rate: cross?.rate
      ? { rate: cross.rate.rate.toString(), date: cross.rate.date, source: cross.rate.source }
      : null,
    converted: cross?.converted?.toJSON() ?? null,
    bankRate: cross?.bankRate.toFixed() ?? null,
  };
}

/**
 * IMP-03@PoC FR 24 — «Позначити як переказ» in the menu «…» of a transaction's detail (no page «Поєднати вручну»,
 * AC22): the candidates for its other side, nearest in date first, then in amount. A writer's action (`household.data.write`:
 * a viewer, an advisor and a scoped member — 403); another space's transaction — 404 (П-5). Behind the release flag and
 * feature key `transactions.transfers`; no plan limit.
 */
export const listTransferCounterpartsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/transactions/{transactionId}/transfer-candidates",
  operationId: "listTransferCounterparts",
  summary:
    "«Позначити як переказ»: the free transactions of the opposite direction on other own accounts within 7 days before or after, in the same currency a credit not above the debit, at most 5 % of the amount below it (another currency — any amount), for «Поєднати в пару» (IMP-03 FR 24)",
  access: { permission: "household.data.write", feature: FEATURE },
  request: { params: z.object({ transactionId: z.uuid() }) },
  response: {
    status: 200,
    description:
      "The transaction and its candidates; «Поєднати в пару» is POST /v1/transactions/{transactionId}/transfer with the chosen one as `counterpartId`. Empty `items`: «Немає транзакцій для пари в межах 7 днів до або після і 5 % суми»",
    schema: z.object({
      transaction: sideSchema,
      items: z.array(counterpartSchema),
      /** The list shows its 50 nearest; there are more. */
      more: z.boolean(),
    }),
  },
  handler: async ({ params }, ctx) => {
    if (ctx.principal.scoped) throw new ApiProblem("FORBIDDEN");
    const { deps } = transferMatchingServices(ctx);
    const result = await listCounterparts(deps, ctx.principal.householdId, params.transactionId);
    if (result.kind === "not-found") throw new ApiProblem("NOT_FOUND");
    if (result.kind === "invalid")
      throw new ApiProblem("VALIDATION_FAILED", {
        errors: result.issues.map((issue) => ({ in: "path" as const, path: "transactionId", issue })),
      });
    return { transaction: side(result.transaction), items: result.items.map(counterpart), more: result.more };
  },
});

const oneSidedWiring = (ctx: Parameters<typeof transferMatchingServices>[0]) => {
  const services = transferMatchingServices(ctx);
  if (services.oneSided === null) throw new ApiProblem("INTERNAL");
  return { deps: services.deps, oneSided: services.oneSided };
};

const listedSideSchema = sideSchema.extend({
  /** «Опис» of the row: the counterparty and the description as typed or imported; null — none. */
  counterparty: z.string().nullable(),
  description: z.string().nullable(),
});

const listedSide = (s: OneSidedSide | ConfirmedPair["outflow"]): z.input<typeof listedSideSchema> => ({
  ...side(s),
  counterparty: s.counterparty,
  description: s.description,
});

/**
 * IMP-03@PoC FR 18, FR 22 (row 242) — «Пари → Односторонні · N»: the one-sided transfers still free — flagged by the
 * system (FR 14: «переказ» to an own account with no pair for 4 days; FR 15: a card payment) or marked «Це переказ».
 * «Це переказ» / «Це не переказ» is PUT /v1/transactions/{transactionId}/one-sided-transfer. The same rights as
 * «Пари · N» (a scoped member: 404).
 */
export const listOneSidedTransfersRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/one-sided-transfers",
  operationId: "listOneSidedTransfers",
  summary:
    "«Односторонні · N»: transactions whose other side is on an account outside Willowsum — flagged (they still count as usual) or marked «Це переказ» (neither income nor expense), newest first (IMP-03 FR 14, FR 18, FR 22)",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description: "The one-sided transfers, newest first, at most 200; `count` — all of them",
    schema: z.object({
      items: z.array(
        listedSideSchema.extend({
          /** `flagged` — «односторонній переказ», counted as usual; `marked` — «Це переказ». */
          state: z.enum(["flagged", "marked"]),
          /** Why it was flagged: `transfer-words`, `own-account-words`, `card-payment`, `category-rule` (a rule «категорія „Переказ“», BUD-21 FR 16; extensible); empty — by hand. */
          evidence: z.array(z.string()),
        }),
      ),
      /** N of «Односторонні · N». */
      count: z.number().int(),
    }),
  },
  handler: async (_input, ctx) => {
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    const { oneSided } = oneSidedWiring(ctx);
    const { items, count } = await oneSided.oneSided(ctx.principal.householdId, PAIR_LIST_MAX);
    return {
      items: items.map((t) => ({ ...listedSide(t), state: t.state, evidence: [...t.evidence] })),
      count,
    };
  },
});

/**
 * IMP-03@PoC FR 18, FR 20, FR 21 (row 242) — «Пари → Підтверджені · N»: the confirmed pairs (transfers between own
 * accounts and exchanges), with the fee or the currency difference the budget counts and its category. «Роз'єднати» is
 * DELETE /v1/transactions/{transactionId}/transfer; «Змінити категорію» PUT …/transfer/fee-category.
 */
export const listConfirmedTransfersRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/transfer-pairs",
  operationId: "listConfirmedTransfers",
  summary:
    "«Підтверджені · N»: the confirmed pairs — neither income nor expense — with the fee or currency difference and its category, newest first (IMP-03 FR 18, FR 20, FR 21)",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description:
      "The confirmed pairs, newest first (by the earlier side), at most 200; `count` — all of them",
    schema: z.object({
      items: z.array(
        z.object({
          /** The transfer's id. */
          id: z.uuid(),
          outflow: listedSideSchema,
          inflow: listedSideSchema,
          /** Edge case 1: the earlier side's date. */
          date: z.string(),
          kind: z.enum(["same-currency", "cross-currency"]).meta({ "x-extensible-enum": true }),
          /** One currency: the fee (negative), an expense of `feeCategoryId`; null — none or two currencies. */
          fee: moneySchema.nullable(),
          /** Two currencies: the credit less the debit at `rate` (a loss negative, a gain positive); else null. */
          currencyDifference: moneySchema.nullable(),
          /** Two currencies: 1 unit of the inflow's currency in the outflow's, the official rate kept when marked. */
          rate: z.object({ rate: z.string(), date: z.string(), source: z.string() }).nullable(),
          /** FR 21: the category the budget counts the fee or difference in; null — «Комісії банку». */
          feeCategoryId: z.uuid().nullable(),
        }),
      ),
      /** N of «Підтверджені · N». */
      count: z.number().int(),
    }),
  },
  handler: async (_input, ctx) => {
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    const { oneSided } = oneSidedWiring(ctx);
    const { items, count } = await oneSided.confirmed(ctx.principal.householdId, PAIR_LIST_MAX);
    return {
      items: items.map((p) => {
        const cross = p.outflow.amount.currency !== p.inflow.amount.currency;
        return {
          id: p.id,
          outflow: listedSide(p.outflow),
          inflow: listedSide(p.inflow),
          date: p.date,
          kind: cross ? ("cross-currency" as const) : ("same-currency" as const),
          fee: !cross && p.difference ? p.difference.amount.toJSON() : null,
          currencyDifference: cross && p.difference ? p.difference.amount.toJSON() : null,
          rate: p.rate && { rate: p.rate.rate.toString(), date: p.rate.date, source: p.rate.source },
          feeCategoryId: p.feeCategoryId,
        };
      }),
      count,
    };
  },
});

/**
 * IMP-03@PoC FR 18, FR 23 (row 242) — «Шукати пари знову»: the search over every free transaction of the space runs
 * again — the proposals are found anew and the one-sided transfers that are one now get the flag (FR 14, FR 15; each
 * with its audit entry). Nothing is marked or confirmed (FR 8). A writer's action (it flags): a viewer, an advisor and a
 * scoped member — 403.
 */
export const searchTransferPairsRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/transfer-proposals/search",
  operationId: "searchTransferPairs",
  summary:
    "«Шукати пари знову»: the pairs are searched for again over every free transaction, and the one-sided transfers flagged; nothing is confirmed (IMP-03 FR 8, FR 14, FR 23)",
  access: { permission: "household.data.write", feature: FEATURE },
  response: {
    status: 200,
    description:
      "How many proposals there are now (N of «Пари · N») and how many transactions this search flagged",
    schema: z.object({
      count: z.number().int(),
      more: z.boolean(),
      /** Flagged «односторонній переказ» by this search. */
      flagged: z.number().int(),
    }),
  },
  handler: async (_input, ctx) => {
    if (ctx.principal.scoped) throw new ApiProblem("FORBIDDEN");
    const { deps, oneSided } = oneSidedWiring(ctx);
    return searchPairsAgain(deps, oneSided, ctx.principal.householdId, ctx.principal.userId);
  },
});

export const transferMatchingRoutes = [
  listTransferProposalsRoute,
  listTransferCounterpartsRoute,
  listOneSidedTransfersRoute,
  listConfirmedTransfersRoute,
  searchTransferPairsRoute,
];
