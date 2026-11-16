import { z } from "zod";
import type { Money } from "@willowsum/domain-kernel";
import { parseTypedAmount } from "../../../liabilities/index.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import {
  assumptionsOf,
  currentMonth,
  deletePlan,
  progressOf,
  savePlan,
  scenarioOf,
  simulateBase,
  strategyOf,
  type Debt,
  type Result,
  type StoredPlan,
} from "../../application/index.ts";
import {
  addMonths,
  ONE_OFFS_MAX,
  type Month,
  type Outcome,
  type PayoffResult,
  type StrategyResult,
} from "../../domain/index.ts";
import { plansTx } from "../db/store.ts";
import { debtPayoffServices, handOffNow } from "./services.ts";

/**
 * «Борги» (BUD-19@PoC FR 1–7, FR 11, AC1–AC8 server parts; wave 2 row 33): the space's debts with the base calculation
 * and the progress, a scenario with extra and one-off payments, both strategies, and the saved plans. The space is the
 * session's (П-5): another space's debt is «not found». A scoped member: «бюджет і цілі» are closed by the visibility
 * policy's default (00-general «Область доступу»). Behind the release flag `debts.payoff` (ships off) under the feature
 * key of the same name; no plan limit («Кількість збережених планів погашення не обмежена»). The product makes no
 * payments; every result is a calculation from the data entered, not advice (FR 10 — the UI's mark).
 */
const MODULE = "debt-payoff";
const FEATURE = "debts.payoff";
const BODY_LIMIT = 8 * 1024;

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const decimal = (description: string) => z.string().max(48).meta({ description });
const month = z.string().max(7).meta({ description: "YYYY-MM" });

/** The scenario's overrides (FR 2, FR 4), in the debt's currency; never written to the liability. */
const scenarioFields = {
  balance: decimal("Overrides the debt; a plain non-negative decimal").optional(),
  annualRate: decimal("Overrides the rate, percent a year, 0–100").optional(),
  monthlyPayment: decimal("Overrides the regular payment, > 0").optional(),
  extraMonthly: decimal("«Додатковий платіж / міс.»").optional(),
  oneOffs: z
    .array(z.object({ month, amount: decimal("> 0") }).strict())
    .max(ONE_OFFS_MAX * 2)
    .optional()
    .meta({
      description: "«Додати разовий платіж»: each after the regular payment of its month (later than now)",
    }),
};

/** A calculation's result (FR 3): paid off, or why not — «За цих умов борг не зменшується», over 1 200 months. */
const outcomeSchema = z.object({
  status: z.enum(["paid", "not-decreasing", "over-limit"]),
  months: z.number().int().nullable(),
  /** The month of the last payment. */
  payoffMonth: z.string().nullable(),
  totalInterest: moneySchema.nullable(),
  /** The balance at the end of each month: the chart «Лінії» and its table (FR 10). */
  schedule: z.array(z.object({ month: z.string(), balance: moneySchema })),
  /** Edge case 5: the months whose one-off payment was capped to the balance left. */
  cappedOneOffs: z.array(z.string()),
});

const planSchema = z.object({
  id: z.uuid(),
  /** The month it was saved in; its month 1 is the next one. */
  startMonth: z.string(),
  balance: moneySchema,
  annualRate: z.string(),
  monthlyPayment: moneySchema,
  extraMonthly: moneySchema,
  oneOffs: z.array(z.object({ month: z.string(), amount: moneySchema })),
  months: z.number().int(),
  totalInterest: moneySchema,
  payoffMonth: z.string(),
  addToPlannedExpenses: z.boolean(),
  version: z.number().int(),
});

const debtSchema = z.object({
  accountId: z.uuid(),
  kind: z.enum(["credit-card", "loan"]),
  name: z.string(),
  /** What is owed, positive. */
  balance: moneySchema,
  annualRate: z.string().nullable(),
  monthlyPayment: moneySchema.nullable(),
  /** AC5: «Вкажіть ставку і платіж, щоб розрахувати план» — no base calculation and no part in «Стратегія». */
  termsMissing: z.boolean(),
  /** FR 1, AC1: the calculation by the liability's own terms; null while terms are missing. */
  base: outcomeSchema.nullable(),
  /** «Прогрес» (FR 7, AC8). */
  progress: z.object({
    paidPercent: z.number().int(),
    remainingMonths: z.number().int().nullable(),
    /** The «План» column; `none` — «Плану немає». */
    plan: z.object({
      status: z.enum(["ahead", "on-track", "behind", "none"]),
      amount: moneySchema.nullable(),
    }),
  }),
  plan: planSchema.nullable(),
});

const scenarioSchema = z.object({
  base: outcomeSchema,
  scenario: outcomeSchema,
  /** «На N міс. раніше, економія на відсотках X €»; null unless both are paid off. */
  saving: z.object({ months: z.number().int(), interest: moneySchema }).nullable(),
});

const strategyOutcomeSchema = z.object({
  status: z.enum(["paid", "not-decreasing", "over-limit"]),
  months: z.number().int().nullable(),
  payoffMonth: z.string().nullable(),
  totalInterest: moneySchema.nullable(),
  /** When each debt is closed. */
  debts: z.array(z.object({ accountId: z.uuid(), months: z.number().int(), payoffMonth: z.string() })),
});

const money = (m: Money) => m.toJSON();

function outcome(o: Outcome<PayoffResult>, now: Month): z.input<typeof outcomeSchema> {
  if (o.kind !== "paid")
    return {
      status: o.kind,
      months: null,
      payoffMonth: null,
      totalInterest: null,
      schedule: [],
      cappedOneOffs: [],
    };
  return {
    status: "paid",
    months: o.months,
    payoffMonth: addMonths(now, o.months),
    totalInterest: money(o.totalInterest),
    schedule: o.balances.map((b, i) => ({ month: addMonths(now, i + 1), balance: money(b) })),
    cappedOneOffs: o.cappedOneOffs.map((m) => addMonths(now, m)),
  };
}

function strategyOutcome(o: Outcome<StrategyResult>, now: Month): z.input<typeof strategyOutcomeSchema> {
  if (o.kind !== "paid")
    return { status: o.kind, months: null, payoffMonth: null, totalInterest: null, debts: [] };
  return {
    status: "paid",
    months: o.months,
    payoffMonth: addMonths(now, o.months),
    totalInterest: money(o.totalInterest),
    debts: [...o.closedIn].map(([accountId, months]) => ({
      accountId,
      months,
      payoffMonth: addMonths(now, months),
    })),
  };
}

const presentPlan = (p: StoredPlan): z.input<typeof planSchema> => ({
  id: p.id,
  startMonth: p.startMonth,
  balance: money(p.balance),
  annualRate: p.annualRate,
  monthlyPayment: money(p.monthlyPayment),
  extraMonthly: money(p.extraMonthly),
  oneOffs: p.oneOffs.map((o) => ({ month: o.month, amount: money(o.amount) })),
  months: p.months,
  totalInterest: money(p.totalInterest),
  payoffMonth: p.payoffMonth,
  addToPlannedExpenses: p.addToPlannedExpenses,
  version: p.version,
});

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
    case "not-paid-off":
      throw new ApiProblem(result.reason === "not-decreasing" ? "DEBT_NOT_DECREASING" : "DEBT_OVER_LIMIT");
  }
}

/** Scoped members: «бюджет і цілі» are closed by the visibility policy's default (00-general «Область доступу»). */
function refuseScoped(ctx: { principal: { scoped: boolean } }): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

async function debtsOf(ctx: ProtectedContext): Promise<{ debts: readonly Debt[]; now: Month }> {
  const { deps } = debtPayoffServices(ctx);
  const today = deps.today();
  return { debts: await deps.debts.debts(ctx.principal.householdId, today), now: currentMonth(today) };
}

async function debtOf(ctx: ProtectedContext, accountId: string): Promise<{ debt: Debt; now: Month }> {
  const { debts, now } = await debtsOf(ctx);
  const debt = debts.find((d) => d.accountId === accountId);
  // AC7: a debt of another space (or none at all) is «not found» — nothing of the space is disclosed.
  if (!debt) throw new ApiProblem("NOT_FOUND");
  return { debt, now };
}

const caller = (ctx: ProtectedContext) => ({
  householdId: ctx.principal.householdId,
  accountId: ctx.principal.userId,
});

const accountParams = z.object({ accountId: z.uuid() });

export const listDebtsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/debts",
  operationId: "listDebts",
  summary: "«Борги»: the credit cards and loans with the base calculation, the progress and the saved plan",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description: "The debts, in the order they were added; empty — «Боргів не додано»",
    schema: z.object({ debts: z.array(debtSchema) }),
  },
  handler: async (_input, ctx) => {
    refuseScoped(ctx);
    const { debts, now } = await debtsOf(ctx);
    const plans = await ctx.inHousehold((q) => plansTx(q).plans(ctx.principal.householdId));
    return {
      debts: debts.map((d) => {
        const plan = plans.find((p) => p.accountId === d.accountId) ?? null;
        const base = simulateBase(d);
        const progress = progressOf(d, plan, now);
        return {
          accountId: d.accountId,
          kind: d.kind,
          name: d.name,
          balance: money(d.balance),
          annualRate: d.annualRate,
          monthlyPayment: d.monthlyPayment === null ? null : money(d.monthlyPayment),
          termsMissing: base === null,
          base: base === null ? null : outcome(base, now),
          progress: {
            paidPercent: progress.paidPercent,
            remainingMonths: progress.remainingMonths,
            plan: progress.plan
              ? { status: progress.plan.status, amount: money(progress.plan.amount) }
              : { status: "none" as const, amount: null },
          },
          plan: plan === null ? null : presentPlan(plan),
        };
      }),
    };
  },
});

export const calculateDebtScenarioRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/debts/{accountId}/scenario",
  operationId: "calculateDebtScenario",
  summary: "A scenario of one debt next to its base (FR 2, FR 4); nothing is written",
  access: { permission: "household.data.read", feature: FEATURE },
  bodyLimitBytes: BODY_LIMIT,
  request: { params: accountParams, body: z.object(scenarioFields).strict() },
  response: { status: 200, description: "The base and the scenario", schema: scenarioSchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { debt, now } = await debtOf(ctx, params.accountId);
    const s = scenarioOf(value(assumptionsOf(debt, body, now)));
    return {
      base: outcome(s.base, now),
      scenario: outcome(s.scenario, now),
      saving: s.saving && { months: s.saving.months, interest: money(s.saving.interest) },
    };
  },
});

export const saveDebtPlanRoute = defineRoute({
  module: MODULE,
  method: "PUT",
  path: "/v1/debts/{accountId}/plan",
  operationId: "saveDebtPlan",
  summary: "«Зберегти план»: the scenario's assumptions and result, one plan per debt (FR 5, AC6)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: BODY_LIMIT,
  problems: ["DEBT_NOT_DECREASING", "DEBT_OVER_LIMIT"],
  request: {
    params: accountParams,
    body: z
      .object({
        ...scenarioFields,
        /** «Додати до запланованих витрат»: the extra payment as a planned expense up to the payoff month. */
        addToPlannedExpenses: z.boolean().optional(),
      })
      .strict(),
  },
  response: { status: 200, description: "The saved plan", schema: planSchema },
  handler: async ({ params, body }, ctx) => {
    const { deps, audit } = debtPayoffServices(ctx);
    const { debt, now } = await debtOf(ctx, params.accountId);
    const { result, handOffs } = await ctx.inHousehold((q) =>
      savePlan(deps, plansTx(q), caller(ctx), debt, body, now),
    );
    await handOffNow(audit, ctx.principal.householdId, handOffs);
    return presentPlan(value(result));
  },
});

export const deleteDebtPlanRoute = defineRoute({
  module: MODULE,
  method: "DELETE",
  path: "/v1/debts/{accountId}/plan",
  operationId: "deleteDebtPlan",
  summary: "Deletes the debt's saved plan; «Плану немає» after it",
  access: { permission: "household.data.write", feature: FEATURE },
  request: { params: accountParams },
  response: { status: 200, description: "Deleted", schema: z.object({ deleted: z.literal(true) }) },
  handler: async ({ params }, ctx) => {
    const { deps, audit } = debtPayoffServices(ctx);
    const { result, handOffs } = await ctx.inHousehold((q) =>
      deletePlan(deps, plansTx(q), caller(ctx), params.accountId),
    );
    await handOffNow(audit, ctx.principal.householdId, handOffs);
    value(result);
    return { deleted: true as const };
  },
});

export const compareDebtStrategiesRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/debts/strategy",
  operationId: "compareDebtStrategies",
  summary:
    "«Стратегія»: Avalanche and Snowball for «Усього на борги / міс.» at once (FR 6, AC3); nothing is written",
  access: { permission: "household.data.read", feature: FEATURE },
  bodyLimitBytes: BODY_LIMIT,
  request: {
    body: z
      .object({
        total: z
          .object({ amount: decimal("«Усього на борги / міс.»"), currency: z.string().max(10) })
          .strict(),
        /** Overrides of a debt's fixed minimum payment or rate; a card without a payment needs one to take part. */
        debts: z
          .array(
            z
              .object({
                accountId: z.uuid(),
                minimumPayment: decimal("> 0").optional(),
                annualRate: decimal("0–100").optional(),
              })
              .strict(),
          )
          .max(100)
          .optional(),
      })
      .strict(),
  },
  response: {
    status: 200,
    description: "Both strategies; the difference is shown neutrally, with no «recommended» mark",
    schema: z.object({
      avalanche: strategyOutcomeSchema,
      snowball: strategyOutcomeSchema,
      included: z.array(z.uuid()),
      excluded: z.array(
        z.object({ accountId: z.uuid(), reason: z.enum(["terms-missing", "currency", "paid-off"]) }),
      ),
    }),
  },
  handler: async ({ body }, ctx) => {
    refuseScoped(ctx);
    const { debts, now } = await debtsOf(ctx);
    const total = parseTypedAmount(body.total.amount, body.total.currency);
    if (total === null || total.isZero())
      throw new ApiProblem("VALIDATION_FAILED", {
        errors: [{ in: "body", path: "total", issue: "invalid" }],
      });
    const s = value(strategyOf(debts, { total, debts: body.debts ?? [] }));
    return {
      avalanche: strategyOutcome(s.avalanche, now),
      snowball: strategyOutcome(s.snowball, now),
      included: [...s.included],
      excluded: [...s.excluded],
    };
  },
});

export const debtPayoffRoutes = [
  listDebtsRoute,
  calculateDebtScenarioRoute,
  saveDebtPlanRoute,
  deleteDebtPlanRoute,
  compareDebtStrategiesRoute,
];
