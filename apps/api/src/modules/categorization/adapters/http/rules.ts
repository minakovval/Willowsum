import { currencyInfo, Money } from "@willowsum/domain-kernel";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import {
  checkRule,
  createRule,
  listRules,
  matchingTransactions,
  moveRule,
  updateRule,
  type AuditHandOff,
  type ListedRule,
  type RuleFields,
  type StoredRule,
} from "../../application/index.ts";
import {
  AMOUNT_OPERATORS,
  RULE_ACCOUNTS_MAX,
  RULE_CONDITIONS_MAX,
  RULES_MAX,
  TEXT_OPERATORS,
  type RuleCondition,
} from "../../domain/index.ts";
import { rulesTx } from "../db/rules.ts";
import { categorizationServices, rulesAuditNow } from "./services.ts";

/**
 * «Правила категорій» (BUD-14@PoC FR 4, FR 5, FR 7 «Показати», FR 10, FR 11, FR 12; AC7, AC8, AC12, AC14; wave 2 row 23
 * — the server part): the space's rules in priority order, «Нове правило», «Змінити правило», «Увімкнено», the order
 * («#», «Вище» / «Нижче») and the existing transactions a rule's conditions match. The space is the session's (П-5): a
 * rule, a category or an account of another space is «not found». A scoped member: «Транзакції» are closed by the
 * visibility policy's default — not found on reads, and changes need `household.data.write`, which a scoped member never
 * has. Behind the release flag `categorization.rules` (ships off) under the feature key of the same name («правила»);
 * no plan limit in this release (BUD-14 «Ліміти плану»), a technical one of `RULES_MAX` rules.
 */
const MODULE = "categorization";
const FEATURE = "categorization.rules";

/** A text of a condition: one line, 1–200 characters once trimmed. */
const text = z
  .string()
  .max(200)
  .refine((s) => s.trim().length > 0 && !/[\r\n]/.test(s), { message: "invalid" });

const moneySchema = z.object({
  /** A positive decimal, no more digits after the point than the currency has. */
  amount: z.string().regex(/^\d{1,15}(\.\d{1,8})?$/),
  currency: z.string().regex(/^[A-Z]{3,5}$/),
});

const conditionSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("merchant"), operator: z.enum(TEXT_OPERATORS), value: text }).strict(),
  z.object({ field: z.literal("description"), operator: z.enum(TEXT_OPERATORS), value: text }).strict(),
  z.object({ field: z.literal("amount"), operator: z.enum(AMOUNT_OPERATORS), value: moneySchema }).strict(),
  z.object({ field: z.literal("account"), operator: z.literal("equals"), value: z.uuid() }).strict(),
]);

const matcherFields = {
  /** «Умови*»: all must hold (FR 5). «Сума» is compared without its sign, in its own currency. */
  conditions: z.array(conditionSchema).min(1).max(RULE_CONDITIONS_MAX),
  /** «Додатково» → «Лише для рахунків»: empty — every account. */
  accountIds: z.array(z.uuid()).max(RULE_ACCOUNTS_MAX),
};

const ruleSchema = z.object({
  id: z.uuid(),
  /** «#»: the priority, 1 — the highest (FR 4). */
  position: z.number().int(),
  conditions: z.array(conditionSchema),
  accountIds: z.array(z.uuid()),
  categoryId: z.uuid(),
  /** «Увімкнено»: a disabled rule is not applied to new transactions (AC12). */
  enabled: z.boolean(),
  /** FR 10, AC7: «Потребує уваги» — the category or an account is gone; skipped until edited. Null — fine. */
  needsAttention: z.enum(["category_deleted", "account_deleted"]).nullable(),
  /** «Застосовано: N транзакцій»: the transactions whose category this rule set and still holds. */
  appliedCount: z.number().int(),
});

const savedSchema = ruleSchema.extend({
  /** FR 11, AC8: a rule with identical conditions that already exists — the warning links to it; null — none. */
  duplicateOf: z.uuid().nullable(),
});

const conditionsOut = (conditions: readonly RuleCondition[]) =>
  conditions.map((c) =>
    c.field === "amount"
      ? {
          field: c.field,
          operator: c.operator,
          value: { amount: c.value.toDecimalString(), currency: c.value.currency },
        }
      : c,
  );

const present = (l: ListedRule): z.input<typeof ruleSchema> => ({
  id: l.rule.id,
  position: l.rule.position,
  conditions: conditionsOut(l.rule.conditions),
  accountIds: [...l.rule.accountIds],
  categoryId: l.rule.categoryId,
  enabled: l.rule.enabled,
  needsAttention: l.attention,
  appliedCount: l.appliedCount,
});

type ConditionInput = z.infer<typeof conditionSchema>;

function conditionsIn(conditions: readonly ConditionInput[]): RuleCondition[] {
  return conditions.map((c, i) => {
    if (c.field !== "amount") return c.field === "account" ? c : { ...c, value: c.value.trim() };
    try {
      const value = Money.of(c.value.amount, c.value.currency);
      if (value.isZero() || value.amount.decimalPlaces() > currencyInfo(value.currency).minorUnits)
        throw new Error("scale");
      return { ...c, value };
    } catch {
      throw new ApiProblem("VALIDATION_FAILED", {
        errors: [{ in: "body", path: `conditions.${i}.value`, issue: "invalid" }],
      });
    }
  });
}

function refuseScoped(ctx: { principal: { scoped: boolean } }): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

function rulesDeps(ctx: ProtectedContext) {
  const services = categorizationServices(ctx);
  if (!services.rules) throw new ApiProblem("INTERNAL");
  return { ...services.rules, audit: services.rulesAudit };
}

async function checked(ctx: ProtectedContext, fields: Partial<RuleFields>): Promise<void> {
  const issue = await checkRule(rulesDeps(ctx).deps, ctx.principal.householdId, fields);
  if (issue) throw new ApiProblem("VALIDATION_FAILED", { errors: [{ in: "body", ...issue }] });
}

/** The saved rule as the list shows it, after the audit entry (right away; the worker writes it if this fails). */
async function saved(
  ctx: ProtectedContext,
  rule: StoredRule,
  duplicateOf: string | null,
  audit: AuditHandOff | null,
): Promise<z.input<typeof savedSchema>> {
  const { deps, audit: log } = rulesDeps(ctx);
  const householdId = ctx.principal.householdId;
  await rulesAuditNow(log, householdId, audit);
  const listed = await ctx.inHousehold((q) => listRules(rulesTx(q), deps, householdId));
  return { ...present(listed.find((l) => l.rule.id === rule.id)!), duplicateOf };
}

const ruleParams = z.object({ ruleId: z.uuid() });

export const listCategoryRulesRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/category-rules",
  operationId: "listCategoryRules",
  summary:
    "«Правила категорій»: the space's rules in priority order, «Потребує уваги», «Застосовано: N» (BUD-14 FR 4)",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description: "The rules, the highest priority first",
    schema: z.object({ items: z.array(ruleSchema) }),
  },
  handler: async (_input, ctx) => {
    refuseScoped(ctx);
    const { deps } = rulesDeps(ctx);
    const householdId = ctx.principal.householdId;
    const listed = await ctx.inHousehold((q) => listRules(rulesTx(q), deps, householdId));
    return { items: listed.map(present) };
  },
});

export const createCategoryRuleRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/category-rules",
  operationId: "createCategoryRule",
  summary:
    "«Зберегти правило» of «Нове правило»: the lowest priority; applies to new transactions only (BUD-14 FR 4, FR 7)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 16 * 1024,
  problems: ["LIMIT_REACHED"],
  request: {
    body: z
      .object({
        ...matcherFields,
        accountIds: matcherFields.accountIds.default([]),
        /** «Категорія*»: of the space's tree in use, not a service one. */
        categoryId: z.uuid(),
        enabled: z.boolean().default(true),
      })
      .strict(),
  },
  response: { status: 201, description: "The rule", schema: savedSchema },
  handler: async ({ body }, ctx) => {
    refuseScoped(ctx);
    const fields: RuleFields = { ...body, conditions: conditionsIn(body.conditions) };
    await checked(ctx, fields);
    const householdId = ctx.principal.householdId;
    const result = await ctx.inHousehold((q) =>
      createRule(rulesTx(q), { householdId, actorAccountId: ctx.principal.userId, id: randomUUID(), fields }),
    );
    if (result.kind === "limit") throw new ApiProblem("LIMIT_REACHED", { extensions: { limit: RULES_MAX } });
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    return saved(ctx, result.rule, result.duplicateOf, result.audit);
  },
});

export const updateCategoryRuleRoute = defineRoute({
  module: MODULE,
  method: "PATCH",
  path: "/v1/category-rules/{ruleId}",
  operationId: "updateCategoryRule",
  summary:
    "«Змінити правило» and «Увімкнено»: new transactions follow the change, past ones keep their categories (BUD-14 FR 4, FR 7)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 16 * 1024,
  request: {
    params: ruleParams,
    body: z
      .object({
        conditions: matcherFields.conditions.optional(),
        accountIds: matcherFields.accountIds.optional(),
        categoryId: z.uuid().optional(),
        enabled: z.boolean().optional(),
      })
      .strict(),
  },
  response: { status: 200, description: "The rule", schema: savedSchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const fields: Partial<RuleFields> = {
      ...(body.conditions !== undefined ? { conditions: conditionsIn(body.conditions) } : {}),
      ...(body.accountIds !== undefined ? { accountIds: body.accountIds } : {}),
      ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    };
    await checked(ctx, fields);
    const householdId = ctx.principal.householdId;
    const result = await ctx.inHousehold((q) =>
      updateRule(rulesTx(q), {
        householdId,
        actorAccountId: ctx.principal.userId,
        id: params.ruleId,
        fields,
      }),
    );
    if (result.kind === "not-found") throw new ApiProblem("NOT_FOUND");
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    return saved(ctx, result.rule, result.duplicateOf, result.audit);
  },
});

export const moveCategoryRuleRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/category-rules/{ruleId}/move",
  operationId: "moveCategoryRule",
  summary:
    "«#» drag, «Вище» / «Нижче»: the rule takes the position, 1 — the highest priority; past categories stay (BUD-14 FR 4, AC14)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 1024,
  request: {
    params: ruleParams,
    body: z.object({ position: z.number().int().min(1).max(RULES_MAX) }).strict(),
  },
  response: {
    status: 200,
    description: "The rules in their new order",
    schema: z.object({ items: z.array(ruleSchema) }),
  },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { deps, audit } = rulesDeps(ctx);
    const householdId = ctx.principal.householdId;
    const result = await ctx.inHousehold((q) =>
      moveRule(rulesTx(q), {
        householdId,
        actorAccountId: ctx.principal.userId,
        id: params.ruleId,
        position: body.position,
      }),
    );
    if (result.kind === "not-found") throw new ApiProblem("NOT_FOUND");
    if (result.kind === "invalid")
      throw new ApiProblem("VALIDATION_FAILED", {
        errors: [{ in: "body", path: result.path, issue: result.issue }],
      });
    await rulesAuditNow(audit, householdId, result.audit);
    const listed = await ctx.inHousehold((q) => listRules(rulesTx(q), deps, householdId));
    return { items: listed.map(present) };
  },
});

const moneyOut = (m: Money) => ({ amount: m.toDecimalString(), currency: m.currency });

export const matchCategoryRuleRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/category-rules/matches",
  operationId: "matchCategoryRule",
  summary:
    "«Показати» and «Застосувати до N наявних транзакцій, що підходять»: the existing transactions the conditions match; nothing changes (BUD-14 FR 7)",
  access: { permission: "household.data.read", feature: FEATURE },
  bodyLimitBytes: 16 * 1024,
  request: {
    body: z.object({ ...matcherFields, accountIds: matcherFields.accountIds.default([]) }).strict(),
  },
  response: {
    status: 200,
    description: "The matching transactions",
    schema: z.object({
      /** N of «Застосувати до N наявних транзакцій, що підходять». */
      count: z.number().int(),
      /** The sum of their signed amounts per currency (no conversion). */
      totals: z.array(moneySchema.extend({ amount: z.string() })),
      /** The newest of them (at most 100): the list «Показати» opens. */
      items: z.array(
        z.object({
          transactionId: z.uuid(),
          accountId: z.uuid(),
          date: z.string(),
          amount: moneySchema.extend({ amount: z.string() }),
          counterparty: z.string().nullable(),
        }),
      ),
      /** The space has more transactions than are matched at once: only the newest were looked at. */
      truncated: z.boolean(),
    }),
  },
  handler: async ({ body }, ctx) => {
    refuseScoped(ctx);
    const services = categorizationServices(ctx);
    const { deps } = rulesDeps(ctx);
    const matches = await matchingTransactions(
      deps,
      ctx.principal.householdId,
      { conditions: conditionsIn(body.conditions), accountIds: body.accountIds },
      services.scanMax,
    );
    return {
      count: matches.count,
      totals: matches.totals.map(moneyOut),
      items: matches.items.map((r) => ({
        transactionId: r.id,
        accountId: r.accountId,
        date: r.date,
        amount: { amount: r.amount, currency: r.currency },
        counterparty: r.counterparty,
      })),
      truncated: matches.truncated,
    };
  },
});

export const rulesRoutes = [
  listCategoryRulesRoute,
  matchCategoryRuleRoute,
  createCategoryRuleRoute,
  updateCategoryRuleRoute,
  moveCategoryRuleRoute,
];
