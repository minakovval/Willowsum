import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import { listProposals, type Proposal } from "../../application/index.ts";
import { FREQUENCIES } from "../../domain/index.ts";
import { recurringServices } from "./services.ts";

/**
 * The proposals of regular payments on the page «Регулярні платежі» (BUD-07@PoC FR 1–5, AC1, AC6; wave 2 row 25 — part
 * a1, the server): the series found in the space's last 430 days of transactions, each with its frequency, expected
 * amount and next date. The space is the session's (П-5): another space's transactions are never read. A scoped
 * member: «Транзакції», which the proposals are made of, are closed by the visibility policy's default — not found.
 * Behind the release flag `recurring.payments` (ships off) under the feature key of the same name; no plan limit
 * (BUD-07 «Ліміти плану»: no plans in this release).
 */
const MODULE = "recurring";
const FEATURE = "recurring.payments";

const proposalSchema = z.object({
  /** The series' key: stable while its first charge is in the analysed window. */
  key: z.string(),
  /** FR 1: the merchant — the one the counterparty shows (module merchants, merges included). */
  merchant: z.object({ id: z.uuid(), name: z.string() }),
  /** FR 6 «тип»: «витрата» (expense) or «дохід» (income). */
  type: z.enum(["expense", "income"]),
  /** FR 2: «тиждень, 2 тижні, місяць, квартал, рік». */
  frequency: z.enum(FREQUENCIES),
  /** FR 3: «змінна» — expected amount = the average of the last 3 charges. */
  variable: z.boolean(),
  /** FR 4 «очікувану суму»: positive; the type gives its direction. */
  expectedAmount: z.object({ amount: z.string(), currency: z.string() }),
  /** FR 4 «дату»: the next date of the schedule anchored at the latest charge (`YYYY-MM-DD`, on or after today). */
  nextDate: z.string(),
  /** The latest charge's date. */
  lastDate: z.string(),
  /** The account of the latest charge («рахунок списання»). */
  accountId: z.uuid(),
  /** The charges of the series, oldest first. */
  transactionIds: z.array(z.uuid()),
});

const present = (p: Proposal): z.input<typeof proposalSchema> => ({
  key: p.key,
  merchant: p.merchant,
  type: p.type,
  frequency: p.frequency,
  variable: p.variable,
  expectedAmount: p.expectedAmount.toJSON(),
  nextDate: p.nextDate,
  lastDate: p.lastDate,
  accountId: p.accountId,
  transactionIds: [...p.transactionIds],
});

export const listRecurringProposalsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/recurring/proposals",
  operationId: "listRecurringProposals",
  summary:
    "Proposals of regular payments: series of one merchant's charges at a frequency with a fixed (± 10 %) or variable amount, from the last 430 days (BUD-07 FR 1–4)",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description: "The proposals by next date; analysed anew on every read",
    schema: z.object({
      items: z.array(proposalSchema),
      /** The window had more transactions than one analysis reads; the latest ones were left out. */
      more: z.boolean(),
    }),
  },
  handler: async (_input, ctx) => {
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    const { deps } = recurringServices(ctx);
    const { items, more } = await listProposals(deps, ctx.principal.householdId);
    return { items: items.map(present), more };
  },
});

export const recurringRoutes = [listRecurringProposalsRoute];
