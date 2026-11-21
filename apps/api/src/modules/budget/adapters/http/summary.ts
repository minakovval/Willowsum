import { z } from "zod";
import type { Money } from "@willowsum/domain-kernel";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import { byId, countsFrom, isIncluded, periodPlan } from "../../application/index.ts";
import {
  isPeriod,
  periodDays,
  periodFigures,
  periodMode,
  periodSummary,
  regularPaymentsOf,
} from "../../domain/index.ts";
import { budgetTx } from "../db/store.ts";
import { budgetServices } from "./services.ts";

/**
 * «Підсумок періоду» (FLW-38@PoC FR 1, AC5, EC1; S-135; BUD-02@PoC FR 16 «минулий період»): the cards over the categories
 * of a finished period — income and expenses against the plan of the snapshot, the net flow and the savings rate, and
 * the month's regular payments with their status. The categories table is `GET /v1/budget/periods/{period}` (the same
 * plan and fact), the three largest changes `GET /v1/budget/compare` with the base «Середнє за 3 міс.». Read only;
 * nothing is written but the snapshot `periodPlan` keeps (the period's first view). The space is the session's; a scoped
 * member — «бюджет і цілі» closed (404); another space's budget is never read. Behind the release flag `budget.summary`
 * (ships off; needs `budget.period`) under the feature key of the same name; no plan limit in this release.
 */
const MODULE = "budget";
const FEATURE = "budget.summary";

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const money = (m: Money) => m.toJSON();

const planFactSchema = z.object({
  actual: moneySchema,
  /** The snapshot's plan. */
  plan: moneySchema,
  /** Actual − plan: positive — «▲» above the plan, negative — «▼» below it; 0 — «—». */
  difference: moneySchema,
});

const chargeSchema = z.object({
  paymentId: z.uuid(),
  categoryId: z.uuid().nullable(),
  /** The date of the schedule (BUD-07 FR 17). */
  dueOn: z.string(),
  /** In the payment's currency. */
  expected: moneySchema,
  /** BUD-07 FR 9: «Сплачено», «Сплачено із запізненням», «Очікується», «Прострочено на N дн.», «Пропущено». */
  status: z.enum(["paid", "paid-late", "expected", "overdue", "skipped"]),
  /** The paying transaction's date; null — not paid. */
  paidOn: z.string().nullable(),
  overdueDays: z.number().int().nullable(),
});

const summarySchema = z.object({
  period: z.string(),
  currency: z.string(),
  /** The dates the fact counts: the month, a proportional first period from its first day (BUD-02 FR 14). */
  window: z.object({ from: z.string(), to: z.string() }),
  income: planFactSchema,
  /** Every expense of the budget accounts: the categories with a limit and «Поза планом»; the plan — the limits. */
  expenses: planFactSchema,
  /** «Чистий потік» = income − expenses (FLW-38 FR 1, AC5). */
  netFlow: moneySchema,
  savingsRate: z.string().nullable().meta({
    description:
      "«Норма заощаджень» = (income − expenses) ÷ income × 100, one digit after the point, half to even («22.5»; negative — more spent than earned). Null — no income: show «–» (FLW-38 EC1)",
  }),
  regularPayments: z
    .object({
      /** «сплачено N з M»: M — how many charges the expense payments had in the month. */
      count: z.number().int(),
      /** N — paid, on time or late. */
      paid: z.number().int(),
      /** «K із запізненням». */
      late: z.number().int(),
      /** «Прострочено» or «Пропущено». */
      missed: z.number().int(),
      items: z.array(chargeSchema),
    })
    .nullable()
    .meta({
      description:
        "The card «Регулярні платежі» of the finished month: every charge of the expense payments, whatever the payment's state now, by date. Null — the regular payments are not known (never an empty card)",
    }),
  /** BUD-02 AC3: as in the period — amounts at the nearest rate and amounts left out without a rate. */
  approximate: z.object({ nearestRateCount: z.number().int(), unavailableCount: z.number().int() }),
});

export const getSummaryRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/budget/periods/{period}/summary",
  operationId: "getBudgetPeriodSummary",
  summary:
    "«Підсумок періоду» of a finished month: income and expenses against the plan, net flow, savings rate, regular payments (FLW-38 FR 1, AC5, EC1)",
  access: { permission: "household.data.read", feature: FEATURE },
  problems: ["BUDGET_PERIOD_BEFORE_START"],
  request: {
    params: z.object({
      period: z.string().max(7).meta({
        description:
          "A finished calendar month, YYYY-MM (the current or a later one — 400 `period: not_finished`)",
      }),
    }),
  },
  response: { status: 200, description: "«Підсумок періоду»", schema: summarySchema },
  handler: async ({ params }, ctx) => {
    // Scoped members: «бюджет і цілі» are closed by the visibility policy's default (00-general «Область доступу»).
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    const invalid = (issue: string) =>
      new ApiProblem("VALIDATION_FAILED", { errors: [{ in: "path" as const, path: "period", issue }] });
    if (!isPeriod(params.period)) throw invalid("invalid");
    const { deps } = budgetServices(ctx);
    const householdId = ctx.principal.householdId;
    const period = params.period;
    const budget = await ctx.inHousehold((q) => budgetTx(q).budget(householdId));
    if (!budget) throw new ApiProblem("NOT_FOUND");
    // BUD-02 FR 16: «Підсумок періоду» is the view of a past month only.
    if (periodMode(period, deps.today()) !== "past") throw invalid("not_finished");
    const categories = byId(await deps.reads.categories(householdId));
    const { plan, choices } = await ctx.inHousehold(async (q) => ({
      plan: await periodPlan(deps, budgetTx(q), householdId, budget, period, categories),
      choices: await budgetTx(q).accountChoices(householdId),
    }));
    if (!plan) throw new ApiProblem("BUDGET_PERIOD_BEFORE_START");
    const from = countsFrom(budget, period);
    const accountIds = (await deps.reads.accounts(householdId))
      .filter((a) => isIncluded(a, choices))
      .map((a) => a.accountId);
    const [counted, charges] = await Promise.all([
      deps.reads.amounts(householdId, accountIds, period, budget.currency, from),
      deps.chargeHistory ? deps.chargeHistory.finishedMonth(householdId, period) : null,
    ]);
    const t = periodFigures(plan, categories, counted.amounts).totals;
    const s = periodSummary({
      incomePlan: plan.incomePlan,
      incomeActual: t.incomeActual!,
      limits: t.limits,
      spentLimited: t.spent!,
      outsidePlan: t.outsidePlan!,
    });
    const regular = charges === null ? null : regularPaymentsOf(charges);
    const days = periodDays(period);
    return {
      period,
      currency: budget.currency,
      window: { from: from ?? days.from, to: days.to },
      income: {
        actual: money(s.income.actual),
        plan: money(s.income.plan),
        difference: money(s.income.difference),
      },
      expenses: {
        actual: money(s.expenses.actual),
        plan: money(s.expenses.plan),
        difference: money(s.expenses.difference),
      },
      netFlow: money(s.netFlow),
      savingsRate: s.savingsRate,
      regularPayments: regular && {
        count: regular.count,
        paid: regular.paid,
        late: regular.late,
        missed: regular.missed,
        items: regular.items.map((c) => ({
          paymentId: c.paymentId,
          categoryId: c.categoryId,
          dueOn: c.dueOn,
          expected: money(c.expected),
          status: c.status,
          paidOn: c.paidOn,
          overdueDays: c.overdueDays,
        })),
      },
      approximate: { nearestRateCount: counted.nearestRateCount, unavailableCount: counted.unavailableCount },
    };
  },
});

export const summaryRoutes = [getSummaryRoute];
