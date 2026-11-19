import { z } from "zod";
import type { Money } from "@willowsum/domain-kernel";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import { cashflowReport } from "../../application/index.ts";
import { monthsOf, PERIOD_TYPES, ratePercent, viewOf } from "../../domain/index.ts";
import { cashflowServices } from "./services.ts";

/**
 * «Грошовий потік» (BUD-08@PoC; wave 2 row 37, server part a): income, spending, net flow and the savings rate of a
 * month, or of each month of a quarter, the year to date or a year, with the period's rate. Read only. The space is the
 * session's (П-5); a scoped member: «бюджет і цілі» are closed by the visibility policy's default — not found. Behind
 * the release flag `budget.cashflow` (ships off) under the feature key of the same name; no plan limit in this release.
 */
const MODULE = "cashflow";
const FEATURE = "budget.cashflow";

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const money = (m: Money) => m.toJSON();
/** FR 3: per cent with one digit after the point (half to even), e.g. "25.0"; null — «–» (no income). */
const rateSchema = z.string().nullable();

const monthSchema = z.object({
  month: z.string(),
  income: moneySchema,
  expenses: moneySchema,
  netFlow: moneySchema,
  savingsRate: rateSchema,
  /** FR 9: uncategorized inflows lowered the spending — the screen's hint. */
  uncategorizedInflows: z.object({ count: z.number().int(), amount: moneySchema }),
});

const reportSchema = z.object({
  type: z.enum(PERIOD_TYPES),
  period: z.string(),
  /** FR 1: «Місяць» for a month, «Помісячно» for a quarter, the year to date or a year. */
  view: z.enum(["month", "monthly"]),
  /** FR 12: the space's reporting currency. */
  currency: z.string(),
  months: z.array(monthSchema),
  totals: z.object({
    income: moneySchema,
    expenses: moneySchema,
    netFlow: moneySchema,
    /** FR 11: (Σ income − Σ expenses) ÷ Σ income of the period. */
    savingsRate: rateSchema,
    /** FR 11: the mean of the monthly rates over the months with income. */
    averageMonthlyRate: rateSchema,
    /** FR 10: the months with the highest and the lowest net flow. */
    highest: z.string().nullable(),
    lowest: z.string().nullable(),
  }),
  /** FR 8, edge case 3: «Перекази без пари» — one-sided operations awaiting their pair, left out. */
  unpairedTransfers: z.number().int(),
  /** FR 12, edge case 4: «приблизно» — amounts at the nearest rate; amounts without any rate are left out. */
  approximate: z.object({
    nearestRateCount: z.number().int(),
    unavailableCount: z.number().int(),
  }),
  /** «Немає транзакцій рахунків бюджету за цей період». */
  empty: z.boolean(),
});

export const getCashflowRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/cashflow",
  operationId: "getCashflow",
  summary:
    "Income, spending, net flow and savings rate of a month or of each month of a period (BUD-08 FR 1, FR 3, FR 11)",
  access: { permission: "household.data.read", feature: FEATURE },
  request: {
    query: z.object({
      type: z.enum(PERIOD_TYPES).meta({ description: "The period type; «Власний» is not offered (FR 1)" }),
      period: z.string().max(7).meta({
        description: "month — YYYY-MM; quarter — YYYY-Qn; ytd and year — YYYY",
      }),
    }),
  },
  response: { status: 200, description: "The period's cash flow", schema: reportSchema },
  handler: async ({ query }, ctx) => {
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    const { deps } = cashflowServices(ctx);
    const months = monthsOf(query.type, query.period, deps.today());
    if (!months)
      throw new ApiProblem("VALIDATION_FAILED", {
        errors: [{ in: "query" as const, path: "period", issue: "invalid" }],
      });
    const report = await cashflowReport(deps, ctx.principal.householdId, months);
    return {
      type: query.type,
      period: query.period,
      view: viewOf(query.type),
      currency: report.currency,
      months: report.months.map((m) => ({
        month: m.month,
        income: money(m.income),
        expenses: money(m.expenses),
        netFlow: money(m.netFlow),
        savingsRate: ratePercent(m.savingsRate),
        uncategorizedInflows: {
          count: m.uncategorizedInflows.count,
          amount: money(m.uncategorizedInflows.amount),
        },
      })),
      totals: {
        income: money(report.totals.income),
        expenses: money(report.totals.expenses),
        netFlow: money(report.totals.netFlow),
        savingsRate: ratePercent(report.totals.savingsRate),
        averageMonthlyRate: ratePercent(report.totals.averageMonthlyRate),
        highest: report.totals.highest,
        lowest: report.totals.lowest,
      },
      unpairedTransfers: report.unpairedTransfers,
      approximate: {
        nearestRateCount: report.nearestRateCount,
        unavailableCount: report.unavailableCount,
      },
      empty: report.empty,
    };
  },
});

export const cashflowRoutes = [getCashflowRoute];
