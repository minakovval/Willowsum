import { z } from "zod";
import { Money } from "@willowsum/domain-kernel";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import { byId, countsFrom, isIncluded, periodPlan, planCellsInEffect } from "../../application/index.ts";
import {
  daysLeft,
  goalContributions,
  isPeriod,
  mandatoryNeeds,
  periodFigures,
  periodOf,
  spendable,
} from "../../domain/index.ts";
import { budgetTx } from "../db/store.ts";
import { budgetServices } from "./services.ts";

/**
 * «Можна витратити» of the current period (BUD-03@PoC c; the read API of the card on «Бюджет», FR 15, and its breakdown,
 * FR 8): `spendable()` over the period's figures (BUD-02), the month's obligations (`BudgetObligations`: unpaid regular
 * payments, loans' monthly payments, regular incomes still expected), the goals' planned contributions of «План»
 * (BUD-17: the month's cells, else the required contribution, less what is contributed this month) and the debts'
 * planned expenses (debt-payoff). Read only; nothing is written but the snapshot `periodPlan` keeps. The space is the
 * session's; a scoped member — «бюджет і цілі» closed (404); another space's budget is never read (AC8). Behind the
 * release flag `budget.spendable` (ships off; needs `budget.period`) under the feature key of the same name; no plan
 * limit in this release. No pace or forecast (FR 11).
 */
const MODULE = "budget";
const FEATURE = "budget.spendable";

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const money = (m: Money) => m.toJSON();
const total = <T extends { amount: Money }>(items: readonly T[], zero: Money) =>
  items.reduce((t, i) => t.plus(i.amount), zero);

const SOURCES = ["obligations", "incomes", "goals", "plannedExpenses"] as const;

const figuresSchema = z.object({
  /** FR 2: to the end of the period; negative — with «−». */
  amount: moneySchema,
  /** FR 4: amount ÷ days left, down to the cent; the last day — the rest; overspent or ≤ 0 — 0. */
  daily: moneySchema,
  /**
   * FR 10, AC4: «Перевитрата N €» — `amount` N = spent − the period's budget; `base` — the optional categories' limits:
   * the shade `over-1`…`over-8` is the share N ÷ base (DS-23 п. 4; base 0 — `over-8`). Null — no overspend.
   */
  overspend: z.object({ amount: moneySchema, base: moneySchema }).nullable(),
  /** FR 3, AC5: `value` = the larger of `plan` and `expected` (= `actual` + regular incomes still expected). */
  income: z.object({
    plan: moneySchema,
    actual: moneySchema,
    /** The actual income plus the regular incomes still expected in the period. */
    expected: moneySchema,
    stillExpected: moneySchema,
    value: moneySchema,
    /** «очікується»: the plan is used — the income has not come in full yet. */
    pending: z.boolean(),
  }),
  /** «Уже витрачене»: `limited` — in the categories with a limit; `outsidePlan` — «Поза планом» and «Без категорії». */
  spent: z.object({ total: moneySchema, limited: moneySchema, outsidePlan: moneySchema }),
  /**
   * FR 5, FR 8: the unpaid regular payments of the period (overdue ones with `overdueDays`) and the unpaid monthly
   * payments of loans, each with its source (`paymentId` — module recurring; `accountId` — the loan account).
   */
  regularPayments: z.object({
    items: z.array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("recurring"),
          paymentId: z.uuid().nullable(),
          categoryId: z.uuid().nullable(),
          dueOn: z.string().nullable(),
          /** «Прострочено на N дн.»; null — not overdue. */
          overdueDays: z.number().int().nullable(),
          amount: moneySchema,
        }),
        z.object({ kind: z.literal("loan"), accountId: z.uuid(), amount: moneySchema }),
      ]),
    ),
    total: moneySchema,
  }),
  /**
   * FR 6: each active goal — the month's planned contribution of «План», contributed this month, and `amount` — what the
   * plan still holds back; `total` — «Цілі» of the sum: Σ max(planned, contributed) (a contribution lowers the sum too).
   */
  goals: z.object({
    items: z.array(
      z.object({ goalId: z.uuid(), planned: moneySchema, contributed: moneySchema, amount: moneySchema }),
    ),
    total: moneySchema,
  }),
  /** FR 6: the debts' planned one-off expenses of the month (saved payoff plans), by account. */
  plannedExpenses: z.object({
    items: z.array(z.object({ accountId: z.uuid(), amount: moneySchema })),
    total: moneySchema,
  }),
  /** FR 14, AC9: «Обов'язкові категорії: ще потрібно N €» — by category and in total. */
  mandatory: z.object({
    categories: z.array(z.object({ categoryId: z.uuid(), amount: moneySchema })),
    total: moneySchema,
  }),
  /** FR 15: the five rows of the card in order; «Цілі» holds the planned expenses too, so the rows add up to the sum. */
  mini: z.array(
    z.object({
      row: z.enum(["income", "spent", "regular", "goals", "mandatory"]),
      amount: moneySchema,
    }),
  ),
});

const spendableSchema = z.object({
  period: z.string(),
  currency: z.string(),
  /** FR 4: days to the end of the period, today included. */
  daysLeft: z.number().int(),
  /** Null — a source has no figure (`unavailable`): «Не вдалося розрахувати суму», never a sum without it. */
  figures: figuresSchema.nullable(),
  /** The sources without a figure (an amount without any rate, or out of range); empty with `figures`. */
  unavailable: z.array(z.enum(SOURCES)),
  /**
   * «приблизно»: transactions at the nearest rate (`nearestRateCount`) or left out (`unavailableCount`), as the period's;
   * `obligations` — a regular payment or loan at the nearest rate.
   */
  approximate: z.object({
    nearestRateCount: z.number().int(),
    unavailableCount: z.number().int(),
    obligations: z.boolean(),
  }),
});

export const getSpendableRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/budget/periods/{period}/spendable",
  operationId: "getBudgetSpendable",
  summary:
    "«Можна витратити» of the current period: the sum, the daily limit, the overspend, the five rows and the breakdown (BUD-03 FR 2–10, FR 14, FR 15)",
  access: { permission: "household.data.read", feature: FEATURE },
  problems: ["BUDGET_PERIOD_BEFORE_START"],
  request: {
    params: z.object({
      period: z.string().max(7).meta({
        description: "The current calendar month, YYYY-MM (another month — 400 `period: not_current`)",
      }),
    }),
  },
  response: { status: 200, description: "«Можна витратити»", schema: spendableSchema },
  handler: async ({ params }, ctx) => {
    // Scoped members: «бюджет і цілі» are closed by the visibility policy's default (00-general «Область доступу»).
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    const invalid = (issue: string) =>
      new ApiProblem("VALIDATION_FAILED", { errors: [{ in: "path" as const, path: "period", issue }] });
    if (!isPeriod(params.period)) throw invalid("invalid");
    const { deps } = budgetServices(ctx);
    const householdId = ctx.principal.householdId;
    const today = deps.today();
    const period = params.period;
    const categories = byId(await deps.reads.categories(householdId));
    const budget = await ctx.inHousehold((q) => budgetTx(q).budget(householdId));
    // AC7: no budget — no card; the page shows the budget's empty state (GET /v1/budget).
    if (!budget) throw new ApiProblem("NOT_FOUND");
    // FR 1–4: the sum runs to the end of the current period from today; a past or future month has none.
    if (period !== periodOf(today)) throw invalid("not_current");
    const { plan, cells, choices } = await ctx.inHousehold(async (q) => ({
      plan: await periodPlan(deps, budgetTx(q), householdId, budget, period, categories),
      // Owner decision 2026-11-20 (batch 2, item 2): with «План» off the goals' typed contributions do not act.
      cells: await planCellsInEffect(deps, budgetTx(q), householdId, budget.id, period),
      choices: await budgetTx(q).accountChoices(householdId),
    }));
    if (!plan) throw new ApiProblem("BUDGET_PERIOD_BEFORE_START");
    const from = countsFrom(budget, period);
    const accountIds = (await deps.reads.accounts(householdId))
      .filter((a) => isIncluded(a, choices))
      .map((a) => a.accountId);
    const [counted, obligations, goals, extra] = await Promise.all([
      deps.reads.amounts(householdId, accountIds, period, budget.currency, from),
      deps.obligations ? deps.obligations.month(householdId, period, budget.currency, from) : null,
      deps.planSources ? deps.planSources.goals(householdId, budget.currency) : [],
      deps.planSources ? deps.planSources.extraPayments(householdId, period, budget.currency) : [],
    ]);
    const figures = periodFigures(plan, categories, counted.amounts);
    const contributions = goalContributions(
      period,
      goals.map((g) => ({ ...g, contributed: g.contributed === undefined ? null : g.contributed })),
      cells,
      budget.currency,
    );
    const unavailable: (typeof SOURCES)[number][] = [];
    if (!obligations) unavailable.push("obligations");
    else if (obligations.incomeExpected === null) unavailable.push("incomes");
    if (!contributions) unavailable.push("goals");
    if (!extra) unavailable.push("plannedExpenses");
    const approximate = {
      nearestRateCount: counted.nearestRateCount,
      unavailableCount: counted.unavailableCount,
      obligations: obligations?.approximate ?? false,
    };
    const base = { period, currency: budget.currency, daysLeft: daysLeft(today, period) };
    if (!obligations || !contributions || !extra || obligations.incomeExpected === null)
      return { ...base, figures: null, unavailable, approximate };
    const zero = Money.zero(budget.currency);
    const stillExpected = obligations.incomeExpected ?? zero;
    const s = spendable({
      today,
      period,
      incomePlan: plan.incomePlan,
      incomeActual: figures.totals.incomeActual!,
      incomeExpected: stillExpected,
      lines: figures.lines,
      outsidePlan: figures.totals.outsidePlan!,
      obligations,
      // Business rules (#641): a contribution is no spending but lowers the sum — what came in this month and what
      // is still planned (Σ max(planned, contributed)).
      goalContributions: contributions.total.plus(contributions.contributed),
      plannedExpenses: total(extra, zero),
      // FR 10: «заплановані заощадження» — the goals' planned contributions and «Заощадження без цілі» of «План».
      plannedSavings: contributions.plannedSavings,
    });
    const needs = mandatoryNeeds(figures.lines, obligations, budget.currency);
    return {
      ...base,
      daysLeft: s.daysLeft,
      figures: {
        amount: money(s.amount),
        daily: money(s.daily),
        overspend: s.overspend && { amount: money(s.overspend.amount), base: money(s.overspend.base) },
        income: {
          plan: money(s.income.plan),
          actual: money(s.income.actual),
          expected: money(s.income.expected),
          stillExpected: money(stillExpected),
          value: money(s.income.value),
          pending: s.income.pending,
        },
        spent: {
          total: money(s.spent),
          limited: money(figures.totals.spent!),
          outsidePlan: money(figures.totals.outsidePlan!),
        },
        regularPayments: {
          items: [
            ...obligations.recurring
              .filter((r) => !r.paid)
              .map((r) => ({
                kind: "recurring" as const,
                paymentId: r.paymentId ?? null,
                categoryId: r.categoryId,
                dueOn: r.dueOn ?? null,
                overdueDays: r.overdueDays ?? null,
                amount: money(r.amount),
              })),
            ...obligations.debtMinimums
              .filter((d) => !d.paid)
              .map((d) => ({ kind: "loan" as const, accountId: d.accountId, amount: money(d.amount) })),
          ],
          total: money(s.regularPayments),
        },
        goals: {
          items: contributions.rows.map((r) => ({
            goalId: r.goalId,
            planned: money(r.planned),
            contributed: money(r.contributed),
            amount: money(r.amount),
          })),
          total: money(s.goalContributions),
        },
        plannedExpenses: {
          items: extra.map((e) => ({ accountId: e.accountId, amount: money(e.amount) })),
          total: money(s.plannedExpenses),
        },
        mandatory: {
          categories: needs.map((n) => ({ categoryId: n.categoryId, amount: money(n.amount) })),
          total: money(s.mandatory),
        },
        mini: s.mini.map((r) => ({ row: r.row, amount: money(r.amount) })),
      },
      unavailable,
      approximate,
    };
  },
});

export const spendableRoutes = [getSpendableRoute];
