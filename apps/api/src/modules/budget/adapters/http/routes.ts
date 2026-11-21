import { z } from "zod";
import type { Money } from "@willowsum/domain-kernel";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import {
  byId,
  countsFrom,
  createBudget,
  deleteBudget,
  isIncluded,
  CHOSEN_MAX,
  LIMITS_MAX,
  periodPlan,
  periodPlans,
  planAllocation,
  wizardSpendable,
  SPENDABLE_MISSING,
  setBudgetAccount,
  updatePlan,
  wizard,
  type Handed,
  type Result,
  type StoredBudget,
} from "../../application/index.ts";
import {
  categoriesSummary,
  expectedPayments,
  isPeriod,
  periodFigures,
  periodMode,
  shareFrom,
  emptyPlan,
  trendLine,
  trendPeriods,
  TREND_MONTHS_MAX,
  ALLOCATION_ROWS_MAX,
  type StartChoice,
} from "../../domain/index.ts";
import { budgetTx } from "../db/store.ts";
import { compareRoutes } from "./compare.ts";
import { planGridRoutes } from "./plan-grid.ts";
import { spendableRoutes } from "./spendable.ts";
import { summaryRoutes } from "./summary.ts";
import { budgetServices, handOffNow } from "./services.ts";

/**
 * The budget of a space (BUD-02@PoC a; wave 2 row 29): one budget per space in its reporting currency, the income plan
 * and the limits of expense categories (a change acts from the current period on, no carry-over), «Поза планом», the
 * accounts of the budget, the snapshot of a finished period and the deletion of the budget. The space is the session's
 * (П-5). A scoped member: «бюджет і цілі» are closed by the visibility policy's default (00-general «Область доступу»)
 * — not found on reads, and changes need `household.data.write`, which a scoped member never has. Behind the release
 * flag `budget.period` (ships off) under the feature key of the same name; no plan limit in this release.
 */
const MODULE = "budget";
const FEATURE = "budget.period";
const BODY_LIMIT = 64 * 1024;

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const moneyInput = z
  .object({
    amount: z.string().max(48).meta({
      description: "A plain non-negative decimal, at most 15 integer digits and the currency's minor units",
    }),
    currency: z
      .string()
      .max(10)
      .meta({ description: "The budget's currency (the space's reporting currency)" }),
  })
  .strict();
const periodText = z.string().max(7).meta({ description: "A calendar month, YYYY-MM" });

/** FR 14: a proportional first period — from its first day to the period's last, `days` of `daysInPeriod` (13/30). */
const shareSchema = z.object({
  from: z.string(),
  to: z.string(),
  days: z.number().int(),
  daysInPeriod: z.number().int(),
});
const share = (budget: StoredBudget, period: string) =>
  budget.firstDay !== null && period === budget.firstPeriod ? shareFrom(budget.firstDay) : null;

const budgetSchema = z.object({
  id: z.uuid(),
  /** FR 1: the space's reporting currency when the budget was created; limits are in it. */
  currency: z.string(),
  /** FR 5: the first period, YYYY-MM. */
  firstPeriod: z.string(),
  /** FR 14: the proportional first period's share of days; null — the first period is whole. */
  proportional: shareSchema.nullable(),
  incomePlan: moneySchema,
  /** FR 7: the limits as they are now (from the current period on); a category without one is «Поза планом». */
  limits: z.array(z.object({ categoryId: z.uuid(), amount: moneySchema })),
  createdOn: z.string(),
  /** Sent back with a change of the plan: another window's change in between is «Бюджет змінено в іншому вікні». */
  version: z.number().int(),
});

const money = (m: Money) => m.toJSON();
const orNull = (m: Money | null) => (m === null ? null : m.toJSON());

async function present(ctx: ProtectedContext, b: StoredBudget): Promise<z.input<typeof budgetSchema>> {
  const limits = await ctx.inHousehold((q) => budgetTx(q).limits(ctx.principal.householdId, b.id));
  return {
    id: b.id,
    currency: b.currency,
    firstPeriod: b.firstPeriod,
    proportional: share(b, b.firstPeriod),
    incomePlan: money(b.incomePlan),
    limits: limits.map((l) => ({ categoryId: l.categoryId, amount: money(l.amount) })),
    createdOn: b.createdOn,
    version: b.version,
  };
}

function value<T>(result: Result<T>): T {
  switch (result.kind) {
    case "ok":
      return result.value;
    case "invalid":
      throw new ApiProblem("VALIDATION_FAILED", {
        errors: result.issues.map((i) => ({ in: "body" as const, path: i.field, issue: i.issue })),
      });
    case "not-found":
      throw new ApiProblem("NOT_FOUND");
    case "exists":
      throw new ApiProblem("BUDGET_EXISTS");
    case "conflict":
      throw new ApiProblem("VERSION_CONFLICT", { extensions: { currentVersion: result.version } });
  }
}

/** Scoped members: «бюджет і цілі» are closed by the visibility policy's default (00-general «Область доступу»). */
function refuseScoped(ctx: { principal: { scoped: boolean } }): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

const caller = (ctx: ProtectedContext) => ({
  householdId: ctx.principal.householdId,
  accountId: ctx.principal.userId,
});

/** A change in one budget transaction (the categories are read before it), then its audit entries. */
async function handed<T>(
  ctx: ProtectedContext,
  change: (
    tx: ReturnType<typeof budgetTx>,
    categories: ReturnType<typeof byId>,
  ) => Promise<Handed<Result<T>>>,
): Promise<T> {
  const { deps, audit } = budgetServices(ctx);
  const categories = byId(await deps.reads.categories(ctx.principal.householdId));
  const { result, handOffs } = await ctx.inHousehold((q) => change(budgetTx(q), categories));
  await handOffNow(audit, ctx.principal.householdId, handOffs);
  return value(result);
}

async function stored(ctx: ProtectedContext): Promise<StoredBudget> {
  const b = await ctx.inHousehold((q) => budgetTx(q).budget(ctx.principal.householdId));
  if (!b) throw new ApiProblem("NOT_FOUND");
  return b;
}

const limitInput = z.object({ categoryId: z.uuid(), amount: moneyInput }).strict();

/**
 * FR 15: a typed row of «Розподіл». A surplus: `goal` (the goal's contribution of the first period; a goal the wizard
 * shows left without a row is saved as 0 €, owner decision 2026-11-20, Q4 а), `debt` (the extra payment above the
 * minimum for one debt), `savings` («Заощадження без цілі»); the rest stays «Не розподілено» («Лишити
 * нерозподіленим» — no row). A deficit: `from-goal` («З цілі …»: the month's contribution lowered by the amount).
 * «Зменшити ліміти» is lower `limits`. `from-savings` («Із заощаджень») and `to-debt` («У борг») are always refused
 * `not_saved`: not saved in PoC (owner decision 2026-11-20, Q3 а).
 */
const allocationRow = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("goal"), goalId: z.uuid(), amount: moneyInput }).strict(),
  z.object({ kind: z.literal("from-goal"), goalId: z.uuid(), amount: moneyInput }).strict(),
  z.object({ kind: z.literal("debt"), accountId: z.uuid(), amount: moneyInput }).strict(),
  z.object({ kind: z.literal("savings"), amount: moneyInput }).strict(),
  z
    .object({ kind: z.literal("from-savings"), accountId: z.uuid().optional(), amount: moneyInput })
    .strict()
    .meta({ description: "«Із заощаджень»: not saved in PoC — always 400 `allocation.<i>.kind: not_saved`" }),
  z
    .object({ kind: z.literal("to-debt"), accountId: z.uuid().optional(), amount: moneyInput })
    .strict()
    .meta({ description: "«У борг»: not saved in PoC — always 400 `allocation.<i>.kind: not_saved`" }),
]);
const allocationInput = z.array(allocationRow).max(ALLOCATION_ROWS_MAX).meta({
  description:
    "The rows of «Розподіл» (FR 15), checked as POST /v1/budget/allocation checks them: each of the balance's kind, a goal or debt of the space once, the sum never over N, a deficit covered exactly. N already holds the goals' planned contributions, so a `goal` row counts as its change against the goal's planned contribution, and a goal with a planned contribution in the budget's currency left without a row is saved as 0 €. «Із заощаджень» (`from-savings`) and «У борг» (`to-debt`) are not saved in PoC: 400 `not_saved`. Saved as the first period's cells of «План»; nothing is moved",
});

export const getBudgetRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/budget",
  operationId: "getBudget",
  summary: "The space's budget, or null — the empty state «Створити за моїми витратами» / «Почати з нуля»",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description: "The budget or null",
    schema: z.object({ budget: budgetSchema.nullable() }),
  },
  handler: async (_input, ctx) => {
    refuseScoped(ctx);
    const b = await ctx.inHousehold((q) => budgetTx(q).budget(ctx.principal.householdId));
    return { budget: b ? await present(ctx, b) : null };
  },
});

export const createBudgetRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/budget",
  operationId: "createBudget",
  summary:
    "Create the space's one budget: first period, income plan and limits (FR 1, FR 2, FR 5; edge case 6)",
  access: { permission: "household.data.write", feature: FEATURE },
  create: true,
  bodyLimitBytes: BODY_LIMIT,
  problems: ["BUDGET_EXISTS"],
  request: {
    body: z
      .object({
        /** The current month (spending since its 1st counts) or the next one; on the 1st — the current one only. */
        firstPeriod: periodText,
        /**
         * FR 14: «Пропорційно на <сьогодні>–<останній день>» — with the current month, not on its 1st: the first period's
         * limits, income plan and planned savings × (days left, today included) ÷ (days in the period).
         */
        proportional: z.boolean().optional(),
        /** 0 by default («Почати з нуля»). */
        incomePlan: moneyInput.optional(),
        /** Expense categories of the space, each once; none — «Почати з нуля». */
        limits: z.array(limitInput).max(LIMITS_MAX).optional(),
        /** FR 15: «Розподіл», saved with the budget in one transaction; none — nothing allocated. */
        allocation: allocationInput.optional(),
      })
      .strict(),
  },
  response: { status: 201, description: "The new budget", schema: budgetSchema },
  handler: async ({ body }, ctx) => {
    const { deps } = budgetServices(ctx);
    // FR 15: the rows are checked against the balance read from the other modules before the budget transaction.
    const cells =
      body.allocation === undefined
        ? []
        : value(
            await planAllocation(
              deps,
              ctx.principal.householdId,
              body,
              byId(await deps.reads.categories(ctx.principal.householdId)),
            ),
          ).cells;
    const b = await handed(ctx, (tx, categories) =>
      createBudget(deps, tx, caller(ctx), body, categories, cells),
    );
    return present(ctx, b);
  },
});

export const updatePlanRoute = defineRoute({
  module: MODULE,
  method: "PATCH",
  path: "/v1/budget/plan",
  operationId: "updateBudgetPlan",
  summary:
    "Set, change or remove limits and change the income plan — from the current period on (FR 7, FR 8, AC4)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: BODY_LIMIT,
  problems: ["VERSION_CONFLICT"],
  request: {
    body: z
      .object({
        /** The budget's version as read; another change in between — 409 VERSION_CONFLICT. */
        version: z.number().int().min(1),
        incomePlan: moneyInput.optional(),
        /** `amount` null removes the limit: the category goes to «Поза планом». */
        limits: z
          .array(z.object({ categoryId: z.uuid(), amount: moneyInput.nullable() }).strict())
          .max(LIMITS_MAX)
          .optional(),
      })
      .strict(),
  },
  response: { status: 200, description: "The budget after the change", schema: budgetSchema },
  handler: async ({ body }, ctx) => {
    refuseScoped(ctx);
    const { deps } = budgetServices(ctx);
    const b = await handed(ctx, (tx, categories) =>
      updatePlan(deps, tx, caller(ctx), body.version, body, categories),
    );
    return present(ctx, b);
  },
});

export const deleteBudgetRoute = defineRoute({
  module: MODULE,
  method: "DELETE",
  path: "/v1/budget",
  operationId: "deleteBudget",
  summary: "«Видалити бюджет» with its limits and snapshots, after the page's confirmation (FR 13, AC13)",
  access: { permission: "household.data.write", feature: FEATURE },
  response: { status: 200, description: "Deleted", schema: z.object({ deleted: z.literal(true) }) },
  handler: async (_input, ctx) => {
    refuseScoped(ctx);
    const { deps } = budgetServices(ctx);
    await handed(ctx, (tx) => deleteBudget(deps, tx, caller(ctx)));
    return { deleted: true as const };
  },
});

const accountSchema = z.object({
  accountId: z.uuid(),
  kind: z.string(),
  status: z.enum(["active", "closed"]),
  /** FR 10: in the budget; by default current accounts, cards and cash. */
  included: z.boolean(),
});

export const listAccountsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/budget/accounts",
  operationId: "listBudgetAccounts",
  summary: "«Рахунки бюджету»: the space's accounts with their switches (FR 10, AC2)",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description: "The accounts in the order of «Рахунки»",
    schema: z.object({ accounts: z.array(accountSchema) }),
  },
  handler: async (_input, ctx) => {
    refuseScoped(ctx);
    const { deps } = budgetServices(ctx);
    await stored(ctx);
    const accounts = await deps.reads.accounts(ctx.principal.householdId);
    const choices = await ctx.inHousehold((q) => budgetTx(q).accountChoices(ctx.principal.householdId));
    return { accounts: accounts.map((a) => ({ ...a, included: isIncluded(a, choices) })) };
  },
});

export const setAccountRoute = defineRoute({
  module: MODULE,
  method: "PUT",
  path: "/v1/budget/accounts/{accountId}",
  operationId: "setBudgetAccount",
  summary: "Switch an account in or out of the budget; it stays in net worth and the list (FR 10, AC2)",
  access: { permission: "household.data.write", feature: FEATURE },
  request: {
    params: z.object({ accountId: z.uuid() }),
    body: z.object({ included: z.boolean() }).strict(),
  },
  response: { status: 200, description: "The account's line", schema: accountSchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { deps } = budgetServices(ctx);
    const account = (await deps.reads.accounts(ctx.principal.householdId)).find(
      (a) => a.accountId === params.accountId,
    );
    if (!account) throw new ApiProblem("NOT_FOUND");
    await handed(ctx, (tx, categories) =>
      setBudgetAccount(deps, tx, caller(ctx), account, body.included, categories),
    );
    return { ...account, included: body.included };
  },
});

const lineSchema = z.object({
  categoryId: z.uuid(),
  /** Null — a category no longer in the space's tree (a finished period's snapshot). */
  groupId: z.uuid().nullable(),
  /** «Обов'язкова» (BUD-01 FR 11); a finished period — as its snapshot keeps it. */
  mandatory: z.boolean(),
  limit: moneySchema,
  /** Null for a future month. */
  spent: moneySchema.nullable(),
  /** Limit − spent; negative — over the limit. Null for a future month. */
  remaining: moneySchema.nullable(),
});

const periodSchema = z.object({
  period: z.string(),
  /** FR 16: «current» — the full budget; «past» — the snapshot's plan against live spending; «future» — the plan only. */
  mode: z.enum(["past", "current", "future"]),
  currency: z.string(),
  incomePlan: moneySchema,
  /** FR 11: planned contributions to goals and «Заощадження без цілі». */
  plannedSavings: moneySchema,
  /** FR 14: a proportional first period — its plan is already × its share and it counts from `from`; else null. */
  proportional: shareSchema.nullable(),
  /** Null for a future month. */
  incomeActual: moneySchema.nullable(),
  /** The categories with a limit, by group in the order of the space's tree. */
  groups: z.array(z.object({ groupId: z.uuid().nullable(), categories: z.array(lineSchema) })),
  /** «Поза планом» (FR 7, AC5): expense categories without a limit with spending; categoryId null — «Без категорії». */
  outsidePlan: z.object({
    categories: z.array(z.object({ categoryId: z.uuid().nullable(), spent: moneySchema })),
    total: moneySchema.nullable(),
  }),
  totals: z.object({ limits: moneySchema, spent: moneySchema.nullable(), remaining: moneySchema.nullable() }),
  /**
   * FR 19, AC9: the totals row over the categories table — «Витрачено A з B», «Перевитрата C у N категоріях», «Ще
   * потрібно на обов'язкові D», «Вільний залишок E» (B − A − D, negative with «−»). Null for a future month. The filter
   * of the card (FR 20) acts on the table only and never changes it.
   */
  summary: z
    .object({
      /** A: spent in the categories with a limit. */
      spent: moneySchema,
      /** B: the sum of the limits. */
      limits: moneySchema,
      /** C (a positive amount) and N: the negative remainders only; 0 and 0 — none. */
      overspend: z.object({ amount: moneySchema, count: z.number().int() }),
      /** The limits of the optional categories: the base of the overspend shade (FR 9). */
      optionalLimits: moneySchema,
      mandatoryRemaining: moneySchema.meta({
        description:
          "Σ max(0, limit − spent) of the mandatory categories, without regular payments. Not «Ще потрібно на обов'язкові»: never show it as D",
      }),
      unpaidRecurring: moneySchema.nullable().meta({
        description:
          "Every unpaid regular payment of the month and every unpaid monthly payment of a loan (BUD-03 FR 5). Null — a past month, or the month's obligations are not known (an amount without any rate or over 15 integer digits): show «—», never 0",
      }),
      mandatoryNeeded: moneySchema.nullable().meta({
        description:
          "D «Ще потрібно на обов'язкові» = Σ over mandatory categories of max(0, limit − spent − their unpaid payments) + their unpaid payments (only the mandatory categories' own; BUD-02 FR 19). Null with unpaidRecurring: show «—», never 0 or mandatoryRemaining",
      }),
      free: moneySchema.nullable().meta({
        description:
          "E «Вільний залишок» = limits − spent − D, negative with «−». Null with D: show «—», never 0",
      }),
    })
    .nullable()
    .meta({ description: "FR 19: the totals row. Null — a future month (plan only, no fact)" }),
  /**
   * FR 16, AC8: «Очікувані платежі» — the regular payments expected in the month by category (categoryId null — none)
   * and their total; null — a past month, or the month's obligations are not known.
   */
  expectedPayments: z
    .object({
      categories: z.array(z.object({ categoryId: z.uuid().nullable(), amount: moneySchema })),
      total: moneySchema,
    })
    .nullable()
    .meta({
      description:
        "FR 16 «Очікувані платежі». Null — a past month, or the month's obligations are not known (an amount without any rate or over 15 integer digits): show «—», never an empty list or 0",
    }),
  /**
   * AC3: «приблизно» — `nearestRateCount` amounts converted at the nearest available rate («N транзакцій за найближчим
   * курсом»); `unavailableCount` amounts left out until their currency has a rate («Курс недоступний»).
   */
  approximate: z.object({ nearestRateCount: z.number().int(), unavailableCount: z.number().int() }),
});

export const getPeriodRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/budget/periods/{period}",
  operationId: "getBudgetPeriod",
  summary:
    "A budget period: limits, spent, «Поза планом», income; a finished one from its snapshot (FR 9, FR 11, FR 16)",
  access: { permission: "household.data.read", feature: FEATURE },
  problems: ["BUDGET_PERIOD_BEFORE_START"],
  request: { params: z.object({ period: periodText }) },
  response: { status: 200, description: "The period", schema: periodSchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    if (!isPeriod(params.period))
      throw new ApiProblem("VALIDATION_FAILED", {
        errors: [{ in: "path" as const, path: "period", issue: "invalid" }],
      });
    const { deps } = budgetServices(ctx);
    const householdId = ctx.principal.householdId;
    const categoryList = await deps.reads.categories(householdId);
    const categories = byId(categoryList);
    const budget = await stored(ctx);
    const plan = await ctx.inHousehold((q) =>
      periodPlan(deps, budgetTx(q), householdId, budget, params.period, categories),
    );
    // Edge case 5: «Бюджет ще не існував на цю дату».
    if (!plan) throw new ApiProblem("BUDGET_PERIOD_BEFORE_START");
    const mode = periodMode(params.period, deps.today());
    let counted = null;
    if (mode !== "future") {
      const choices = await ctx.inHousehold((q) => budgetTx(q).accountChoices(householdId));
      const accountIds = (await deps.reads.accounts(householdId))
        .filter((a) => isIncluded(a, choices))
        .map((a) => a.accountId);
      counted = await deps.reads.amounts(
        householdId,
        accountIds,
        params.period,
        budget.currency,
        countsFrom(budget, params.period),
      );
    }
    const figures = periodFigures(plan, categories, counted?.amounts ?? null);
    // FR 16: a past month is «план проти факту» — no «Очікувані платежі», no «Ще потрібно» (#567).
    const obligations =
      deps.obligations && mode !== "past"
        ? await deps.obligations.month(
            householdId,
            params.period,
            budget.currency,
            countsFrom(budget, params.period),
          )
        : null;
    // FR 16: a past month is «план проти факту» — no «Ще потрібно» or «Вільний залишок» (D, E null).
    const summary = mode === "future" ? null : categoriesSummary(figures.lines, budget.currency, obligations);
    const expected = obligations ? expectedPayments(obligations, budget.currency) : null;
    const order = new Map(categoryList.map((c, i) => [c.groupId, i]));
    const groups = new Map<string | null, z.input<typeof lineSchema>[]>();
    for (const l of [...figures.lines].sort(
      (a, b) => (order.get(a.groupId ?? "") ?? 1e9) - (order.get(b.groupId ?? "") ?? 1e9),
    ))
      groups.set(l.groupId, [
        ...(groups.get(l.groupId) ?? []),
        {
          categoryId: l.categoryId,
          groupId: l.groupId,
          mandatory: l.mandatory,
          limit: money(l.limit),
          spent: orNull(l.spent),
          remaining: orNull(l.remaining),
        },
      ]);
    const t = figures.totals;
    return {
      period: params.period,
      mode,
      currency: budget.currency,
      incomePlan: money(plan.incomePlan),
      plannedSavings: money(plan.plannedSavings),
      proportional: share(budget, params.period),
      incomeActual: orNull(t.incomeActual),
      groups: [...groups.entries()].map(([groupId, lines]) => ({ groupId, categories: lines })),
      outsidePlan: {
        categories: figures.outsidePlan.map((o) => ({ categoryId: o.categoryId, spent: money(o.spent) })),
        total: orNull(t.outsidePlan),
      },
      totals: {
        limits: money(t.limits),
        spent: orNull(t.spent),
        remaining: t.spent === null ? null : money(t.limits.minus(t.spent)),
      },
      summary: summary && {
        spent: money(summary.spent),
        limits: money(summary.limits),
        overspend: { amount: money(summary.overspend.amount), count: summary.overspend.count },
        optionalLimits: money(summary.optionalLimits),
        mandatoryRemaining: money(summary.mandatoryRemaining),
        unpaidRecurring: orNull(summary.unpaidRecurring),
        mandatoryNeeded: orNull(summary.mandatoryNeeded),
        free: orNull(summary.free),
      },
      expectedPayments: expected && {
        categories: expected.categories.map((c) => ({ categoryId: c.categoryId, amount: money(c.amount) })),
        total: money(expected.total),
      },
      approximate: {
        nearestRateCount: counted?.nearestRateCount ?? 0,
        unavailableCount: counted?.unavailableCount ?? 0,
      },
    };
  },
});

const startSchema = z.object({
  /** «З 1 <місяця>» / «З наступного місяця (1 <місяця>)» / «Пропорційно на <день>–<останній> (<days>/<daysInPeriod>)». */
  start: z.enum(["period-start", "next-period", "proportional"]),
  /** What POST /v1/budget takes as `firstPeriod` (with `proportional: true` for the third). */
  firstPeriod: z.string(),
  from: z.string(),
  to: z.string(),
  days: z.number().int().nullable(),
  daysInPeriod: z.number().int().nullable(),
});

const wizardSchema = z.object({
  today: z.string(),
  /** FR 14, AC15: show «Ви починаєте посеред періоду»; no choice is preselected. False on the 1st (FR 5). */
  midPeriod: z.boolean(),
  starts: z.array(startSchema),
  fromSpending: z.object({
    /** FR 2: at least 3 full months of categorized transactions; false — only «Почати з нуля» (edge case 2). */
    available: z.boolean(),
    /** Full months back from the last one with categorized transactions, without a gap (at most 6). */
    historyMonths: z.number().int(),
    /** FR 3: the average income of the 3 months; edge case 1 — the lowest of 6 for an irregular income. */
    incomePlan: moneySchema.nullable(),
    incomeIrregular: z.boolean(),
    /** FR 3, FR 7: each active expense category with spending — its 3-month average and the limit (tens, half up). */
    categories: z.array(
      z.object({ categoryId: z.uuid(), average: moneySchema, limit: moneySchema.nullable() }),
    ),
  }),
});

export const getWizardRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/budget/wizard",
  operationId: "getBudgetWizard",
  summary:
    "The budget wizard: the start choices and the proposal «Створити за моїми витратами» (FR 2, FR 3, FR 14; AC1, AC15)",
  access: { permission: "household.data.read", feature: FEATURE },
  response: { status: 200, description: "The wizard's figures; nothing is saved", schema: wizardSchema },
  handler: async (_input, ctx) => {
    refuseScoped(ctx);
    const { deps } = budgetServices(ctx);
    const householdId = ctx.principal.householdId;
    const categories = byId(await deps.reads.categories(householdId));
    const choices = await ctx.inHousehold((q) => budgetTx(q).accountChoices(householdId));
    const accountIds = (await deps.reads.accounts(householdId))
      .filter((a) => isIncluded(a, choices))
      .map((a) => a.accountId);
    const w = await wizard(deps, householdId, accountIds, categories);
    const p = w.fromSpending;
    return {
      today: w.today,
      midPeriod: w.midPeriod,
      starts: w.starts.map((c: StartChoice) => ({ ...c })),
      fromSpending: {
        available: p.available,
        historyMonths: p.historyMonths,
        incomePlan: p.incomePlan === null ? null : money(p.incomePlan),
        incomeIrregular: p.incomeIrregular,
        categories: p.limits.map((l) => ({
          categoryId: l.categoryId,
          average: money(l.average),
          limit: orNull(l.limit),
        })),
      },
    };
  },
});

const allocationSchema = z.object({
  /** The first period of the plan (as POST /v1/budget takes it). */
  period: z.string(),
  /** The income plan the figures use: × the share of days for a proportional first period (FR 14). */
  incomePlan: moneySchema,
  /** The sum of the limits, as the income plan. */
  limits: moneySchema,
  /** Null — the month's regular payments and loans' monthly payments are not known: no difference without them. */
  balance: z
    .object({
      /** «Регулярні платежі поза лімітами»: the month's payments whose category has no limit. */
      recurringOutsideLimits: moneySchema,
      /** FR 3, AC6: the bar of the limits step — income plan − limits − regular payments outside limits. */
      unallocated: moneySchema,
      /** «Мінімальні платежі за боргами». */
      debtMinimums: moneySchema,
      /** FR 15 (Q5 а): the goals' planned contributions of the month, as «План» subtracts them. */
      goalContributions: moneySchema,
      /** FR 15: unallocated − debt minimums − goal contributions; negative — a deficit. */
      difference: moneySchema,
      /** «профіцит N» / «Звідки візьмуться N?» / nothing to allocate. */
      kind: z.enum(["surplus", "deficit", "balanced"]),
      /** N = |difference|. */
      amount: moneySchema,
    })
    .nullable()
    .meta({
      description:
        "Null — the month's regular payments and loans' monthly payments, or a goal's planned contribution, are not known (an amount without any rate or over 15 integer digits): no difference, no «не розподілено»; never show income − limits instead",
    }),
  /**
   * FR 15, AC7: the chosen amounts against N — `exact`: a deficit is covered in full («Створити бюджет» active);
   * `short`: a surplus's rest stays «Не розподілено», a deficit is not covered yet; `over`: more than N. Null without
   * `chosen` in the request or without `balance`.
   */
  choice: z
    .object({ chosen: moneySchema, rest: moneySchema, status: z.enum(["short", "exact", "over"]) })
    .nullable()
    .meta({
      description:
        "Null — no `chosen` or `allocation` in the request, or `balance` is null; a deficit counts as covered only when status is `exact`",
    }),
  /**
   * FR 3, AC6: «Можна витратити в <місяць> ≈ M» — BUD-03 FR 2 for the first period as the plan would start it (with
   * `allocation`, its goal contributions and extra debt payments). `amount` null — `missing` names what is not known.
   */
  spendable: z.object({
    period: z.string(),
    amount: moneySchema.nullable(),
    missing: z.array(z.enum(SPENDABLE_MISSING)).meta({
      description:
        "Why `amount` is null: `obligations` (the month's payments unknown), `rates` (an amount without a rate: a transaction, a goal's contribution, a regular income, a payoff plan's payment). Never show a figure without them",
    }),
  }),
});

export const previewAllocationRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/budget/allocation",
  operationId: "previewBudgetAllocation",
  summary:
    "The wizard's «Розподіл»: the bar of the limits step and the surplus or deficit of the plan not saved yet (FR 3, FR 15; AC6, AC7)",
  access: { permission: "household.data.read", feature: FEATURE },
  bodyLimitBytes: BODY_LIMIT,
  request: {
    body: z
      .object({
        /** As POST /v1/budget: the current or the next month. */
        firstPeriod: periodText,
        /** As POST /v1/budget: the proportional first period (the plan × the share of days). */
        proportional: z.boolean().optional(),
        incomePlan: moneyInput.optional(),
        limits: z.array(limitInput).max(LIMITS_MAX).optional(),
        chosen: z.array(moneyInput).max(CHOSEN_MAX).optional().meta({
          description:
            "The amounts chosen on the step: goals, extra debt payments, «Заощадження без цілі», or the deficit options «З цілі», «Із заощаджень», «У борг». «Зменшити ліміти» is sent as lower `limits` only (it changes N), never also here. Each amount counts in full (N already holds the goals' planned contributions: `allocation` counts a goal's change against it). Not with `allocation`",
        }),
        /** FR 15: the typed rows, as POST /v1/budget saves them (400 on what it would refuse). */
        allocation: allocationInput.optional(),
      })
      .strict(),
  },
  response: {
    status: 200,
    description: "The figures; nothing is saved and nothing is moved",
    schema: allocationSchema,
  },
  handler: async ({ body }, ctx) => {
    refuseScoped(ctx);
    const { deps } = budgetServices(ctx);
    const householdId = ctx.principal.householdId;
    const categories = byId(await deps.reads.categories(householdId));
    const p = value(await planAllocation(deps, householdId, body, categories));
    const b = p.balance;
    // The accounts the budget would take (FR 10 defaults; as the wizard reads them).
    const choices = await ctx.inHousehold((q) => budgetTx(q).accountChoices(householdId));
    const accountIds = (await deps.reads.accounts(householdId))
      .filter((a) => isIncluded(a, choices))
      .map((a) => a.accountId);
    const s = await wizardSpendable(deps, householdId, p, accountIds, categories);
    return {
      period: p.period,
      incomePlan: money(p.plan.incomePlan),
      limits: money(p.limits),
      balance: b && {
        recurringOutsideLimits: money(b.recurringOutsideLimits),
        unallocated: money(b.unallocated),
        debtMinimums: money(b.debtMinimums),
        goalContributions: money(b.goalContributions),
        difference: money(b.difference),
        kind: b.kind,
        amount: money(b.amount),
      },
      choice: p.choice && {
        chosen: money(p.choice.chosen),
        rest: money(p.choice.rest),
        status: p.choice.status,
      },
      spendable: { period: s.period, amount: orNull(s.amount), missing: [...s.missing] },
    };
  },
});

/**
 * BUD-16@PoC a) (wave 2 row 32): the method «Ліміти» is the only one (FR 1), so the trend knows no method — no history
 * of methods, no marks of a change (FR 4). Behind its own release flag and feature key `budget.trend` (ships off).
 */
const TREND_FEATURE = "budget.trend";

const trendSchema = z.object({
  currency: z.string(),
  /** FR 4, oldest first: one entry per month from `from` to `to`. */
  months: z.array(
    z.object({
      period: z.string(),
      mode: z.enum(["past", "current", "future"]),
      plan: moneySchema.nullable().meta({
        description:
          "«План місяця» = the sum of the month's limits (a finished month — its snapshot's); with `categoryId` — that category's limit. Null — a month before the budget, or the category had no limit that month: no plan line",
      }),
      spent: moneySchema.nullable().meta({
        description:
          "The month's spending: every expense category, «Поза планом» and «Без категорії» (with `categoryId` — that category's). Null — a future month",
      }),
      income: moneySchema.nullable().meta({ description: "The month's income. Null — a future month" }),
    }),
  ),
  /** As a period's: amounts at the nearest rate, and left out (no rate, or over 15 integer digits), over all months. */
  approximate: z.object({ nearestRateCount: z.number().int(), unavailableCount: z.number().int() }),
});

export const getTrendRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/budget/trend",
  operationId: "getBudgetTrend",
  summary:
    "The trend: the plan line (the sum of the month's limits), spending and income per month (BUD-16 FR 4; facts only, FR 5)",
  access: { permission: "household.data.read", feature: TREND_FEATURE },
  request: {
    query: z.object({
      from: periodText,
      to: periodText.meta({
        description: `A calendar month, YYYY-MM; at most ${TREND_MONTHS_MAX} months from \`from\``,
      }),
      categoryId: z
        .uuid()
        .optional()
        .meta({ description: "An expense category of the space: its limit and spending" }),
    }),
  },
  response: { status: 200, description: "The months", schema: trendSchema },
  handler: async ({ query }, ctx) => {
    refuseScoped(ctx);
    const periods = trendPeriods(query.from, query.to);
    const invalid = (path: string, issue: string) =>
      new ApiProblem("VALIDATION_FAILED", { errors: [{ in: "query" as const, path, issue }] });
    if (!Array.isArray(periods)) throw invalid(periods.field, periods.issue);
    const { deps } = budgetServices(ctx);
    const householdId = ctx.principal.householdId;
    const categories = byId(await deps.reads.categories(householdId));
    if (query.categoryId !== undefined) {
      const c = categories.get(query.categoryId);
      if (!c || c.state === "retired") throw invalid("categoryId", "not_found");
      if (c.kind !== "expense") throw invalid("categoryId", "not_expense");
    }
    const budget = await stored(ctx);
    const plans = await ctx.inHousehold((q) =>
      // BUD-16 FR 4: «План місяця» is the sum of the limits: income and savings are not read.
      periodPlans(deps, budgetTx(q), householdId, budget, periods, categories, true),
    );
    const choices = await ctx.inHousehold((q) => budgetTx(q).accountChoices(householdId));
    const accountIds = (await deps.reads.accounts(householdId))
      .filter((a) => isIncluded(a, choices))
      .map((a) => a.accountId);
    const today = deps.today();
    let nearestRateCount = 0;
    let unavailableCount = 0;
    const months = [];
    for (const period of periods) {
      const mode = periodMode(period, today);
      const plan = plans.get(period) ?? null;
      let counted = null;
      if (mode !== "future") {
        counted = await deps.reads.amounts(
          householdId,
          accountIds,
          period,
          budget.currency,
          countsFrom(budget, period),
        );
        nearestRateCount += counted.nearestRateCount;
        unavailableCount += counted.unavailableCount;
      }
      const figures = periodFigures(plan ?? emptyPlan(budget.currency), categories, counted?.amounts ?? null);
      const line = trendLine(plan, figures, budget.currency, query.categoryId);
      months.push({
        period,
        mode,
        plan: orNull(line.plan),
        spent: orNull(line.spent),
        income: orNull(line.income),
      });
    }
    return { currency: budget.currency, months, approximate: { nearestRateCount, unavailableCount } };
  },
});

export const budgetRoutes = [
  getBudgetRoute,
  getWizardRoute,
  previewAllocationRoute,
  createBudgetRoute,
  updatePlanRoute,
  deleteBudgetRoute,
  listAccountsRoute,
  setAccountRoute,
  getPeriodRoute,
  getTrendRoute,
  ...compareRoutes,
  ...planGridRoutes,
  ...spendableRoutes,
  ...summaryRoutes,
];
