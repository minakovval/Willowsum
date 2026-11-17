import { currencyInfo, Money } from "@willowsum/domain-kernel";
import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import { categorySuggestions, type Suggestion } from "../../application/index.ts";
import { rulesTx } from "../db/rules.ts";
import { categorizationTx } from "../db/store.ts";
import { categorizationServices } from "./services.ts";

/**
 * The category hints of «Нова транзакція» S-048, step 2 «Контрагент і категорія» (FIN-03@PoC FR 30, FR 31; FR 15;
 * issue #438 — the server part): the category the form fills in for the counterparty («підставлено з правила …» or
 * «як раніше»), the first group of the list «Категорія» («Часто для <мерчанта>» or «Нещодавні») and, for the list
 * «Контрагент», each known merchant's category. Read only. The space is the session's (П-5): nothing of another space
 * is read. A scoped member: «Транзакції» are closed by the visibility policy's default — not found. Behind the release
 * flag `categorization.suggestions` (ships off; requires `categorization.rules`) under the feature key of the same name;
 * no plan limit.
 */
const MODULE = "categorization";
const FEATURE = "categorization.suggestions";

const suggestionSchema = z.object({
  /** A category of the space's tree (`GET /v1/categories`): in use, not hidden, of the type asked for. */
  categoryId: z.uuid(),
  /** FR 15: «за правилом» (`rule`) or «як раніше» (`merchant` — the last category set by hand for this merchant). */
  source: z.enum(["rule", "merchant"]),
  /** BUD-14 FR 13: the rule and its place in the order («підставлено з правила …»); null unless `source` is `rule`. */
  rule: z.object({ id: z.uuid(), position: z.number().int() }).nullable(),
});

const present = (s: Suggestion | null): z.input<typeof suggestionSchema> | null =>
  s === null ? null : { categoryId: s.categoryId, source: s.source, rule: s.rule };

export const getCategorySuggestionsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/category-suggestions",
  operationId: "getCategorySuggestions",
  summary:
    "«Нова транзакція» step 2: the category for the counterparty, «Часто для <мерчанта>» or «Нещодавні», and each known merchant's category (FIN-03 FR 30, FR 31)",
  access: { permission: "household.data.read", feature: FEATURE },
  request: {
    query: z.object({
      /** «Контрагент» as typed or chosen: one line, at most 200 characters. */
      counterparty: z
        .string()
        .max(200)
        .refine((s) => !/[\r\n]/.test(s), { message: "invalid" })
        .optional(),
      /** «Рахунок» of step 1: a rule «Рахунок» or «Лише для рахунків» is matched only with it. */
      accountId: z.uuid().optional(),
      /** «Сума» of step 1, without a sign; with `currency`. A rule «Сума» is matched only with it. */
      amount: z
        .string()
        .regex(/^\d{1,15}(\.\d{1,8})?$/)
        .optional(),
      currency: z
        .string()
        .regex(/^[A-Z]{3,5}$/)
        .optional(),
      /** «Тип»: only categories of this type are offered. */
      type: z.enum(["expense", "income"]).optional(),
    }),
  },
  response: {
    status: 200,
    description: "The hints",
    schema: z.object({
      /** The shown merchant name of the counterparty (title of «Часто для <мерчанта>»); null — no counterparty. */
      merchant: z.string().nullable(),
      /** FR 30: the category the form fills in for the counterparty; null — none. */
      suggestion: suggestionSchema.nullable(),
      /** FR 31: the first group of «Категорія», at most 3 categories. */
      top: z.object({
        /** `frequent` — «Часто для <merchant>»; `recent` — «Нещодавні». */
        kind: z.enum(["frequent", "recent"]),
        /** The merchant of «Часто для …»; null for «Нещодавні». */
        merchant: z.string().nullable(),
        categoryIds: z.array(z.uuid()),
      }),
      /** FR 30: «23 транзакції · Продукти» — the known merchants of the space with a category to show, by name. */
      merchants: z.array(z.object({ name: z.string(), suggestion: suggestionSchema })),
      /** The space has more transactions than are read at once: only the newest were looked at. */
      truncated: z.boolean(),
    }),
  },
  handler: async ({ query }, ctx) => {
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    const services = categorizationServices(ctx);
    if (!services.rules) throw new ApiProblem("INTERNAL");
    if ((query.amount === undefined) !== (query.currency === undefined))
      throw new ApiProblem("VALIDATION_FAILED", {
        errors: [
          { in: "query", path: query.amount === undefined ? "amount" : "currency", issue: "required" },
        ],
      });
    let amount: Money | null = null;
    if (query.amount !== undefined && query.currency !== undefined) {
      try {
        amount = Money.of(query.amount, query.currency);
        if (amount.amount.decimalPlaces() > currencyInfo(amount.currency).minorUnits)
          throw new Error("scale");
      } catch {
        throw new ApiProblem("VALIDATION_FAILED", {
          errors: [{ in: "query", path: "amount", issue: "invalid" }],
        });
      }
    }
    const householdId = ctx.principal.householdId;
    const hints = await categorySuggestions(
      services.rules.deps,
      (fn) =>
        ctx.inHousehold((q) => {
          const categories = categorizationTx(q);
          const rules = rulesTx(q);
          return fn({ read: (h, ids) => categories.read(h, ids), rules: (h) => rules.rules(h) });
        }),
      householdId,
      {
        counterparty: query.counterparty ?? null,
        accountId: query.accountId ?? null,
        amount,
        type: query.type ?? null,
      },
      services.scanMax,
    );
    return {
      merchant: hints.merchant,
      suggestion: present(hints.suggestion),
      top: { kind: hints.top.kind, merchant: hints.top.merchant, categoryIds: [...hints.top.categoryIds] },
      merchants: hints.merchants.map((m) => ({ name: m.name, suggestion: present(m.suggestion)! })),
      truncated: hints.truncated,
    };
  },
});
