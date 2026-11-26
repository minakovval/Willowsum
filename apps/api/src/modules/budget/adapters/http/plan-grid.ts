import { z } from "zod";
import type { Money } from "@willowsum/domain-kernel";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute } from "../../../../platform/http/route.ts";
import { byId, planLines, readPlanGrid, setPlanCell, type CellResult } from "../../application/index.ts";
import { gridMonths, isPeriod, PLAN_LINE_KINDS, type GridCell } from "../../domain/index.ts";
import { budgetTx } from "../db/store.ts";
import { planRatesSchema, ratesOut } from "./rates.ts";
import { budgetServices, handOffNow } from "./services.ts";

/**
 * «Бюджет → План» (BUD-17@PoC a; wave 2 row 35; UI — row 127): the grid of the current month and the 11 next and the
 * change of one cell. The space is the session's; a scoped member — «бюджет і цілі» closed (404); another space's
 * budget is never read (AC5). Behind the release flag `budget.plan` (ships off; needs `budget.period`) under the feature
 * key of the same name; no plan limit in this release.
 */
const MODULE = "budget";
const FEATURE = "budget.plan";

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const orNull = (m: Money | null) => (m === null ? null : m.toJSON());

const cellSchema = z.object({
  /** The month's value; null — empty. */
  amount: moneySchema.nullable(),
  /** FR 2: the month's own value (true) or the line's default — the budget-wide plan, a goal's required contribution. */
  own: z.boolean(),
  /** FR 3: sent back with a change of this cell. */
  version: z.number().int(),
});
const totalsSchema = z.array(moneySchema.nullable());
/** ARC-07 FR 3: a response field kept for 6 months after this mark, then removed (row 231). */
const DEPRECATED = { deprecated: true, "x-deprecated-since": "2026-11-26" };

const gridSchema = z.object({
  currency: z.string(),
  /** FR 1: the current month and the 11 next; `inBudget` false — before the budget's first period (read only). */
  months: z.array(
    z.object({ period: z.string(), mode: z.enum(["current", "future"]), inBudget: z.boolean() }),
  ),
  /**
   * «Надходження» (owner decision 2026-11-21, 2 б; row 231): `categories` — a row per active income category of the
   * budget's plan in the tree's order, a cell — the category's plan of the month in its own currency (default — its
   * plan in the budget; `kind` `income`, `lineId` the category); `totals` — the month's income plan, the sum of the
   * rows in the budget's currency. `plan`, `rows` and `other` — the former «План доходу», regular incomes and «Інші
   * надходження»: deprecated (ARC-07 FR 3); `plan` carries the month's income plan as a cell without an own value,
   * `rows` is empty, `other` null.
   */
  income: z.object({
    categories: z.array(z.object({ categoryId: z.uuid(), cells: z.array(cellSchema) })),
    plan: z.array(cellSchema).meta(DEPRECATED),
    rows: z
      .array(
        z.object({
          paymentId: z.uuid(),
          cells: z.array(cellSchema.extend({ expected: z.boolean() })),
        }),
      )
      .meta(DEPRECATED),
    other: totalsSchema.meta(DEPRECATED),
    totals: totalsSchema,
  }),
  /** «Витрати»: the active expense categories by group in the tree's order; a cell — the month's limit. */
  expenses: z.object({
    groups: z.array(
      z.object({
        groupId: z.uuid(),
        categories: z.array(z.object({ categoryId: z.uuid(), cells: z.array(cellSchema) })),
      }),
    ),
    totals: totalsSchema,
  }),
  /** «Цілі й заощадження»: each active goal's planned contribution (default — the required one) and «Заощадження без цілі». */
  goals: z.object({
    rows: z.array(
      z.object({
        goalId: z.uuid(),
        cells: z.array(cellSchema.extend({ required: moneySchema.nullable() })),
      }),
    ),
    savings: z.array(cellSchema),
    totals: totalsSchema,
  }),
  /** «Погашення боргів» (read only): each debt's minimum payment and its saved plan's extra payment. */
  debts: z.object({
    rows: z.array(
      z.object({
        accountId: z.uuid(),
        cells: z.array(z.object({ minimum: moneySchema.nullable(), extra: moneySchema.nullable() })),
      }),
    ),
    totals: totalsSchema,
  }),
  /**
   * BUD-17 business rules (owner decision 2026-11-26): a category's cells are in its currency (BUD-02 FR 24); the sums
   * of the sections and «Не розподілено» are in the budget's, such a cell at today's rate — these rates; not empty — those
   * sums are shown with «≈» and the hint names the rate.
   */
  rates: planRatesSchema,
  /** «Не розподілено N €» or «Дефіцит N €» (`deficit`, the absolute value); null — a section has no figure (no rate). */
  unallocated: z.array(
    z.object({ kind: z.enum(["unallocated", "deficit"]), amount: moneySchema }).nullable(),
  ),
});

const cell = (c: GridCell) => ({ amount: orNull(c.amount), own: c.own, version: c.version });
const totals = (xs: readonly (Money | null)[]) => xs.map(orNull);

/** Scoped members: «бюджет і цілі» are closed by the visibility policy's default (00-general «Область доступу»). */
function refuseScoped(ctx: { principal: { scoped: boolean } }): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

export const getPlanGridRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/budget/plan-grid",
  operationId: "getBudgetPlanGrid",
  summary:
    "«План»: income, limits, goals and savings, debt payments and «Не розподілено» for 12 months (FR 1, AC1, AC6)",
  access: { permission: "household.data.read", feature: FEATURE },
  response: { status: 200, description: "The grid", schema: gridSchema },
  handler: async (_input, ctx) => {
    refuseScoped(ctx);
    const { deps } = budgetServices(ctx);
    const householdId = ctx.principal.householdId;
    const categories = await deps.reads.categories(householdId);
    const budget = await ctx.inHousehold((q) => budgetTx(q).budget(householdId));
    // «План ще не заповнено»: without a budget the page offers «Заповнити вручну» (the wizard of BUD-02).
    if (!budget) throw new ApiProblem("NOT_FOUND");
    const stored = await ctx.inHousehold(async (q) => ({
      limits: await budgetTx(q).limits(householdId, budget.id),
      incomePlans: await budgetTx(q).incomePlans(householdId, budget.id),
      cells: await budgetTx(q).planCells(householdId, budget.id, gridMonths(deps.today())[0]),
    }));
    const grid = await readPlanGrid(deps, householdId, budget, categories, stored);
    return {
      currency: budget.currency,
      months: [...grid.months],
      income: {
        categories: grid.income.categories.map((r) => ({
          categoryId: r.categoryId,
          cells: r.cells.map(cell),
        })),
        plan: grid.income.totals.map((t) => ({ amount: orNull(t), own: false, version: 0 })),
        rows: [],
        other: grid.income.totals.map(() => null),
        totals: totals(grid.income.totals),
      },
      expenses: {
        groups: grid.expenses.groups.map((g) => ({
          groupId: g.groupId,
          categories: g.categories.map((c) => ({ categoryId: c.categoryId, cells: c.cells.map(cell) })),
        })),
        totals: totals(grid.expenses.totals),
      },
      goals: {
        rows: grid.goals.rows.map((r) => ({
          goalId: r.goalId,
          cells: r.cells.map((c) => ({ ...cell(c), required: orNull(c.required) })),
        })),
        savings: grid.goals.savings.map(cell),
        totals: totals(grid.goals.totals),
      },
      debts: {
        rows: grid.debts.rows.map((r) => ({
          accountId: r.accountId,
          cells: r.cells.map((c) => ({ minimum: orNull(c.minimum), extra: orNull(c.extra) })),
        })),
        totals: totals(grid.debts.totals),
      },
      rates: ratesOut({ rates: grid.rates }),
      unallocated: grid.unallocated.map((u) => (u ? { kind: u.kind, amount: u.amount.toJSON() } : null)),
    };
  },
});

function cellValue(result: CellResult) {
  switch (result.kind) {
    case "ok":
      return result.value;
    case "invalid":
      throw new ApiProblem("VALIDATION_FAILED", {
        errors: result.issues.map((i) => ({ in: "body" as const, path: i.field, issue: i.issue })),
      });
    case "not-found":
      throw new ApiProblem("NOT_FOUND");
    case "before-start":
      throw new ApiProblem("BUDGET_PERIOD_BEFORE_START");
    case "conflict":
      throw new ApiProblem("VERSION_CONFLICT", { extensions: { currentVersion: result.version } });
  }
}

export const setPlanCellRoute = defineRoute({
  module: MODULE,
  method: "PUT",
  path: "/v1/budget/plan-grid/cells",
  operationId: "setBudgetPlanCell",
  summary:
    "Change one cell of «План» for its month only, saved at once; a past month is read only (FR 2, FR 3, AC2–AC4)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 4 * 1024,
  problems: ["VERSION_CONFLICT", "BUDGET_PERIOD_BEFORE_START"],
  request: {
    body: z
      .object({
        /** The current month or one of the 11 next (400 `period`: `past` — «Минулий місяць змінити не можна», `too_far`). */
        period: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .meta({ description: "A calendar month, YYYY-MM" }),
        kind: z.enum(PLAN_LINE_KINDS),
        /** The expense category, the income category of the budget's plan, the goal; null — «Заощадження без цілі». */
        lineId: z.uuid().nullable(),
        /** Null — back to the line's default. */
        amount: z
          .object({ amount: z.string().max(48), currency: z.string().max(10) })
          .strict()
          .nullable(),
        /** The cell's version as read (0 — no own value); another save in between — 409 VERSION_CONFLICT. */
        version: z.number().int().min(0),
      })
      .strict(),
  },
  response: {
    status: 200,
    description: "The cell after the change",
    schema: z.object({ amount: moneySchema.nullable(), version: z.number().int() }),
  },
  handler: async ({ body }, ctx) => {
    refuseScoped(ctx);
    const { deps, audit } = budgetServices(ctx);
    const caller = { householdId: ctx.principal.householdId, accountId: ctx.principal.userId };
    const categories = byId(await deps.reads.categories(caller.householdId));
    // The month's lines (the active goals) from their module, before the budget transaction.
    const lines = isPeriod(body.period)
      ? await planLines(deps, caller.householdId, deps.reportingCurrency)(body.period)
      : { goalIds: new Set<string>() };
    const { result, handOffs } = await ctx.inHousehold((q) =>
      setPlanCell(deps, budgetTx(q), caller, body, categories, lines),
    );
    await handOffNow(audit, caller.householdId, handOffs);
    const v = cellValue(result);
    return { amount: orNull(v.amount), version: v.version };
  },
});

export const planGridRoutes = [getPlanGridRoute, setPlanCellRoute];
