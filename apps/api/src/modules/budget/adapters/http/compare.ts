import { z } from "zod";
import type { Money } from "@willowsum/domain-kernel";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import { byId, countsFrom, isIncluded, periodPlans, type StoredBudget } from "../../application/index.ts";
import {
  addMonths,
  averageBase,
  baseWindow,
  BASES_BY_TYPE,
  categoryTotals,
  COMPARE_BASES,
  COMPARE_TYPES,
  compareSelection,
  compareTable,
  defaultBase,
  isCompareYear,
  periodMode,
  periodOf,
  yearTable,
  type Change,
  type CompareBase,
  type CompareRow,
  type CompareSelection,
  type CountedAmount,
  type DateWindow,
  type YearRow,
} from "../../domain/index.ts";
import { budgetTx } from "../db/store.ts";
import { budgetServices } from "./services.ts";

/**
 * BUD-06@PoC a) (wave 2 row 36): the figures of «Планування → Бюджет → Порівняння» and «Рік: план і факт» — spending and
 * income of the budget's accounts by category, against a base and against the plan (the sum of the month's limits, a
 * finished month — its snapshot's: BUD-16's `periodPlans` / `monthPlan`). Facts only: numbers and codes, no text. The
 * space is the session's; a scoped member gets 404 («бюджет і цілі» are closed by default). Behind the release flag and
 * feature key `budget.compare` (ships off, requires `budget.period`). The page (row 132) words and colours them.
 */
const MODULE = "budget";
const FEATURE = "budget.compare";

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const money = (m: Money) => m.toJSON();
const orNull = (m: Money | null) => (m === null ? null : m.toJSON());

const changeSchema = z.object({
  /** Signed: now − the value compared with. */
  amount: moneySchema,
  percent: z.string().nullable().meta({
    description:
      "Of the value compared with, unsigned, one decimal; null — it is 0 (the difference in € only, AC7)",
  }),
  direction: z.enum(["up", "down", "none"]).meta({ description: "«▲» / «▼»; none — «без змін» (blue «—»)" }),
  tone: z.enum(["gain", "gain-soft", "loss", "loss-soft", "none"]).meta({
    description:
      "Better or worse, not the direction: less spending and more income — gain; -soft — up to 10 % inclusive; none — «без змін»",
  }),
});
const change = (c: Change | null) =>
  c && { amount: money(c.amount), percent: c.percent, direction: c.direction, tone: c.tone };

const rowSchema = z.object({
  /** Null — «Без категорії» (or the total). */
  categoryId: z.uuid().nullable(),
  current: moneySchema,
  plan: moneySchema.nullable().meta({
    description:
      "The limits of the period's months by their snapshots; null — «Поза планом» («–») or before the budget",
  }),
  planDifference: changeSchema.nullable(),
  base: moneySchema.nullable().meta({ description: "Null — the base is not available" }),
  difference: changeSchema.nullable(),
  transactions: z.object({ current: z.number().int(), base: z.number().int().nullable() }).meta({
    description: "How many transactions (split parts) made the amounts; an average's — rounded to whole ones",
  }),
});
const row = (r: CompareRow) => ({
  categoryId: r.categoryId,
  current: money(r.current),
  plan: orNull(r.plan),
  planDifference: change(r.planDifference),
  base: orNull(r.base),
  difference: change(r.difference),
  transactions: r.transactions,
});

const windowSchema = z.object({ from: z.string(), to: z.string() });
const approximateSchema = z.object({
  nearestRateCount: z.number().int(),
  unavailableCount: z.number().int(),
});

const compareSchema = z.object({
  currency: z.string(),
  type: z.enum(COMPARE_TYPES),
  /** What the table counts: the period, up to today while it lasts. */
  window: windowSchema,
  inProgress: z.boolean(),
  /** FR 6: a finished period — «Найбільші зміни» opens «Підсумок <місяць>». */
  finished: z.boolean(),
  /** FR 11: the calendar year «Рік: план і факт» opens on. */
  year: z.string(),
  /** The empty state «Ще немає завершених періодів для порівняння» is 0: finished months with data. */
  finishedPeriods: z.number().int(),
  /** FR 1, FR 5: the bases of the type, for «Порівняти з: <база> ˅». */
  bases: z.array(
    z.object({
      base: z.enum(COMPARE_BASES),
      available: z.boolean(),
      reason: z.enum(["no_history", "no_finished_periods"]).nullable().meta({
        description:
          "Why not available: no_history — no data in the base's dates («імпортуйте старі виписки», FR 5); no_finished_periods — no whole finished period for an average",
      }),
      /** FR 4: the months an average is over («за N міс.» when fewer than asked); null — not an average. */
      months: z.number().int().nullable(),
    }),
  ),
  /** The chosen base: its dates (null — not available) and whether «Повний попередній період» is on. */
  base: z.object({
    base: z.enum(COMPARE_BASES),
    available: z.boolean(),
    window: windowSchema.nullable(),
    months: z.number().int().nullable(),
    full: z.boolean(),
  }),
  /** Spending by expense category with «Без категорії», sorted by the absolute difference (FR 6). */
  /** `overall` — «Усього витрат» / the month's income. */
  expenses: z.object({ overall: rowSchema, categories: z.array(rowSchema) }),
  income: z.object({ overall: rowSchema, categories: z.array(rowSchema) }),
  /** FR 6: the three largest changes of spending — the page words them as facts. */
  largest: z.array(
    z.object({
      categoryId: z.uuid().nullable(),
      difference: moneySchema,
      transactions: z.object({ current: z.number().int(), base: z.number().int().nullable() }),
    }),
  ),
  /** Amounts at the nearest rate, and left out (no rate, over 15 integer digits, past the money type), both windows. */
  approximate: approximateSchema,
});

async function budgetAccounts(ctx: ProtectedContext, householdId: string): Promise<string[]> {
  const { deps } = budgetServices(ctx);
  const choices = await ctx.inHousehold((q) => budgetTx(q).accountChoices(householdId));
  return (await deps.reads.accounts(householdId))
    .filter((a) => isIncluded(a, choices))
    .map((a) => a.accountId);
}

const invalid = (path: string, issue: string) =>
  new ApiProblem("VALIDATION_FAILED", { errors: [{ in: "query" as const, path, issue }] });

/** Scoped members: «бюджет і цілі» are closed by the visibility policy's default; no budget — 404, as the trend. */
async function storedBudget(ctx: ProtectedContext): Promise<StoredBudget> {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
  const b = await ctx.inHousehold((q) => budgetTx(q).budget(ctx.principal.householdId));
  if (!b) throw new ApiProblem("NOT_FOUND");
  return b;
}

interface ResolvedBase {
  readonly base: CompareBase;
  readonly available: boolean;
  readonly reason: "no_history" | "no_finished_periods" | null;
  readonly window: DateWindow | null;
  readonly months: number | null;
  /** How many periods the base's amounts hold: 1, or N for an average. */
  readonly divisor: number;
  /** An average: the months whose amounts it sums (finished, with data); null — not an average. */
  readonly included: readonly string[] | null;
}

/** FR 2–FR 5: the dates of a base, and whether it is there to compare with. */
function resolveBase(
  selection: CompareSelection,
  base: CompareBase,
  full: boolean,
  historyStart: string | null,
  withData: ReadonlySet<string>,
): ResolvedBase {
  if (base === "previous" || base === "last-year") {
    const window = baseWindow(selection, base, full);
    // FR 5: «Той самий період минулого року» needs data there; so does «Попередній період».
    const available = historyStart !== null && historyStart <= window.to;
    return {
      base,
      available,
      reason: available ? null : "no_history",
      window,
      months: null,
      divisor: 1,
      included: null,
    };
  }
  const a = averageBase(selection, base === "avg3" ? 3 : base === "avg6" ? 6 : 12, historyStart, withData);
  return {
    base,
    available: a.window !== null,
    reason: a.window === null ? "no_finished_periods" : null,
    window: a.window,
    months: a.months,
    divisor: Math.max(a.periods, 1),
    included: a.included,
  };
}

/** Finished months from the one the history starts in to the last one before today. */
function finishedMonths(historyStart: string | null, today: string): number {
  if (historyStart === null) return 0;
  let n = 0;
  for (let p = periodOf(historyStart); p < periodOf(today); p = addMonths(p, 1)) n += 1;
  return n;
}

export const getCompareRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/budget/compare",
  operationId: "getBudgetCompare",
  summary:
    "«Порівняння»: spending and income by category against a base and against the plan (BUD-06 FR 1–FR 6; facts only)",
  access: { permission: "household.data.read", feature: FEATURE },
  request: {
    query: z.object({
      type: z.enum(COMPARE_TYPES),
      period: z.string().max(7).optional().meta({
        description:
          "month — YYYY-MM; quarter — YYYY-Qn; year — YYYY; ytd — YYYY, this year by default; a past year — 1 January to the same date",
      }),
      base: z.enum(COMPARE_BASES).optional().meta({
        description:
          "Default — previous (month, quarter) or last-year (year, ytd); year and ytd take last-year only",
      }),
      full: z.enum(["true", "false"]).optional().meta({
        description: "«Повний попередній період»: the base whole, not cut at the same date",
      }),
    }),
  },
  response: { status: 200, description: "The table of categories", schema: compareSchema },
  handler: async ({ query }, ctx) => {
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    const { deps } = budgetServices(ctx);
    const today = deps.today();
    const selection = compareSelection(query, today);
    if (!("window" in selection)) throw invalid(selection.field, selection.issue);
    const chosen = query.base ?? defaultBase(selection.type);
    if (!BASES_BY_TYPE[selection.type].includes(chosen)) throw invalid("base", "not_for_type");
    const budget = await storedBudget(ctx);
    const householdId = ctx.principal.householdId;
    const currency = budget.currency;
    const full = query.full === "true";
    const categories = byId(await deps.reads.categories(householdId));
    const accountIds = await budgetAccounts(ctx, householdId);
    const historyStart = await deps.reads.historyStart(householdId, accountIds);
    const read = (w: DateWindow) => deps.reads.window(householdId, accountIds, w.from, w.to, currency);
    // FR 4: an average counts only finished periods with data — one read of the widest one's dates tells which.
    const widest = BASES_BY_TYPE[selection.type].includes("avg12")
      ? averageBase(selection, 12, historyStart, null).window
      : null;
    const averages = widest ? await read(widest) : null;
    const withData = new Set((averages?.amounts ?? []).map((a) => a.period));
    const bases = BASES_BY_TYPE[selection.type].map((b) =>
      resolveBase(selection, b, full, historyStart, withData),
    );
    const base = bases.find((b) => b.base === chosen)!;
    const current = await read(selection.window);
    let baseRead: Awaited<ReturnType<typeof read>> | null = null;
    if (base.available && base.included !== null && averages) {
      const months = new Set(base.included);
      // The counts of approximate amounts are the read's: reuse the widest read only for its own dates.
      const source = base.window!.from === widest!.from ? averages : await read(base.window!);
      baseRead = { ...source, amounts: source.amounts.filter((a) => months.has(a.period)) };
    } else if (base.available && base.window) baseRead = await read(base.window);
    // «План» — BUD-16's rule: the sum of the month's limits, a finished month — its snapshot's.
    const plans = await ctx.inHousehold((q) =>
      periodPlans(deps, budgetTx(q), householdId, budget, selection.months, categories),
    );
    // BUD-02 FR 14: the plan columns compare with the budget period's fact — a proportional first period from its
    // first day, as «Бюджет» and «Тренд» count it; every other month — the window's amounts of that month.
    const planFact: CountedAmount[] = [];
    for (const p of selection.months) {
      const since = countsFrom(budget, p);
      if (since === undefined) planFact.push(...current.amounts.filter((a) => a.period === p));
      else planFact.push(...(await deps.reads.amounts(householdId, accountIds, p, currency, since)).amounts);
    }
    const table = compareTable({
      currency,
      current: categoryTotals(categories, current.amounts, currency),
      base: baseRead && {
        sums: categoryTotals(categories, baseRead.amounts, currency),
        divisor: base.divisor,
      },
      plans: selection.months.map((p) => plans.get(p) ?? null),
      planCurrent: categoryTotals(categories, planFact, currency),
    });
    return {
      currency,
      type: selection.type,
      window: selection.window,
      inProgress: selection.inProgress,
      finished: selection.finished,
      year: selection.year,
      finishedPeriods: finishedMonths(historyStart, today),
      bases: bases.map((b) => ({ base: b.base, available: b.available, reason: b.reason, months: b.months })),
      base: {
        base: base.base,
        available: base.available,
        window: base.available ? base.window : null,
        months: base.months,
        full,
      },
      expenses: { overall: row(table.expenses.total), categories: table.expenses.categories.map(row) },
      income: { overall: row(table.income.total), categories: table.income.categories.map(row) },
      largest: table.largest.map((l) => ({
        categoryId: l.categoryId,
        difference: money(l.difference),
        transactions: l.transactions,
      })),
      approximate: {
        nearestRateCount: current.nearestRateCount + (baseRead?.nearestRateCount ?? 0),
        unavailableCount: current.unavailableCount + (baseRead?.unavailableCount ?? 0),
      },
    };
  },
});

const cellSchema = z.object({
  fact: moneySchema.nullable().meta({ description: "Null — a future month: the plan only (grey)" }),
  plan: moneySchema
    .nullable()
    .meta({ description: "The month's plan; null — before the budget or no limit («–»)" }),
  difference: changeSchema.nullable().meta({ description: "«± до плану»; null without a fact or a plan" }),
});
const yearRowSchema = z.object({
  cells: z.array(cellSchema),
  /** «Разом за рік», «План», «Різниця» — over the finished months of the year. */
  total: moneySchema,
  plan: moneySchema.nullable(),
  difference: changeSchema.nullable(),
});
const yearRow = (r: YearRow) => ({
  cells: r.cells.map((c) => ({
    fact: orNull(c.fact),
    plan: orNull(c.plan),
    difference: change(c.difference),
  })),
  total: money(r.total),
  plan: orNull(r.plan),
  difference: change(r.difference),
});

const yearSchema = z.object({
  currency: z.string(),
  year: z.string(),
  months: z.array(z.object({ period: z.string(), mode: z.enum(["past", "current", "future"]) })),
  /** «Дохід» on top: the fact and the income plan. */
  income: yearRowSchema,
  /** Category rows by group in the order of the tree; «Без категорії» — group null, last. */
  groups: z.array(
    yearRowSchema.extend({
      groupId: z.uuid().nullable(),
      categories: z.array(yearRowSchema.extend({ categoryId: z.uuid().nullable() })),
    }),
  ),
  /** «Усього витрат». */
  expenses: yearRowSchema,
  approximate: approximateSchema,
});

export const getCompareYearRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/budget/compare/year",
  operationId: "getBudgetCompareYear",
  summary: "«Рік: план і факт»: categories × 12 months, the fact and «± до плану» (BUD-06 FR 11; facts only)",
  access: { permission: "household.data.read", feature: FEATURE },
  request: {
    query: z.object({
      year: z.string().max(4).meta({ description: "A calendar year, YYYY (the compare answer's `year`)" }),
    }),
  },
  response: { status: 200, description: "The year", schema: yearSchema },
  handler: async ({ query }, ctx) => {
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    if (!isCompareYear(query.year)) throw invalid("year", "invalid");
    const budget = await storedBudget(ctx);
    const { deps } = budgetServices(ctx);
    const householdId = ctx.principal.householdId;
    const currency = budget.currency;
    const today = deps.today();
    const list = await deps.reads.categories(householdId);
    const categories = byId(list);
    const periods = Array.from({ length: 12 }, (_, i) => `${query.year}-${String(i + 1).padStart(2, "0")}`);
    const plans = await ctx.inHousehold((q) =>
      periodPlans(deps, budgetTx(q), householdId, budget, periods, categories),
    );
    const from = `${query.year}-01-01`;
    const to = `${query.year}-12-31` < today ? `${query.year}-12-31` : today;
    const accountIds = from <= today ? await budgetAccounts(ctx, householdId) : [];
    const read =
      from <= today
        ? await deps.reads.window(householdId, accountIds, from, to, currency)
        : { amounts: [], nearestRateCount: 0, unavailableCount: 0 };
    const byMonth = new Map<string, CountedAmount[]>();
    for (const a of read.amounts) {
      const list = byMonth.get(a.period);
      if (list) list.push(a);
      else byMonth.set(a.period, [a]);
    }
    // BUD-02 FR 14: a proportional first period counts from its first day, as «Бюджет» and «Тренд».
    const first = budget.firstPeriod;
    const since = countsFrom(budget, first);
    if (since !== undefined && periods.includes(first) && periodMode(first, today) !== "future")
      byMonth.set(first, [
        ...(await deps.reads.amounts(householdId, accountIds, first, currency, since)).amounts,
      ]);
    const months = periods.map((period) => ({ period, mode: periodMode(period, today) }));
    const table = yearTable({
      currency,
      months: months.map((m) => ({
        mode: m.mode,
        plan: plans.get(m.period) ?? null,
        sums: m.mode === "future" ? null : categoryTotals(categories, byMonth.get(m.period) ?? [], currency),
      })),
      categories: list,
    });
    return {
      currency,
      year: query.year,
      months,
      income: yearRow(table.income),
      groups: table.groups.map((g) => ({
        ...yearRow(g),
        groupId: g.groupId,
        categories: g.categories.map((c) => ({ ...yearRow(c), categoryId: c.categoryId })),
      })),
      expenses: yearRow(table.expenses),
      approximate: { nearestRateCount: read.nearestRateCount, unavailableCount: read.unavailableCount },
    };
  },
});

export const compareRoutes = [getCompareRoute, getCompareYearRoute];
