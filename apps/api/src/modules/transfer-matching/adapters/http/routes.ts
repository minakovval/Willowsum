import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import { listCounterparts, listProposals } from "../../application/index.ts";
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
   * paired (FR 24, FR 9); positive, the credit exceeds the debit (`markable` false). Two currencies: the credit less the
   * debit at the reference `rate` (FR 21, unrounded), null without a rate.
   */
  difference: moneySchema.nullable(),
  /** «Поєднати в пару» (`POST /v1/transactions/{id}/transfer`) accepts the pair; false — it answers `amount_mismatch`. */
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
    "«Позначити як переказ»: the free transactions of the opposite direction on other own accounts within 7 days before or after, in the same currency within ±5 % of the amount (another currency — any amount), for «Поєднати в пару» (IMP-03 FR 24)",
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

export const transferMatchingRoutes = [listTransferProposalsRoute, listTransferCounterpartsRoute];
