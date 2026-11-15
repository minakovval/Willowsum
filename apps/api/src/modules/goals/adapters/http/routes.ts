import { z } from "zod";
import type { Money } from "@willowsum/domain-kernel";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import {
  contribute,
  createGoal,
  deleteGoal,
  mergeGoal,
  partBalance,
  updateGoal,
  viewGoals,
  type GoalView,
  type Handed,
  type Result,
  type StoredGoal,
} from "../../application/index.ts";
import { checkGoal, GOAL_TEMPLATES, NAME_MAX, PART_KINDS } from "../../domain/index.ts";
import { goalsTx } from "../db/store.ts";
import { goalsServices, handOffNow } from "./services.ts";

/**
 * Savings goals of a space (BUD-05@PoC FR 2–7, FR 11–13, edge cases 2–4; wave 2 row 27): create, change and delete a
 * goal with its one part, «Внести», and what the list and the card show — collected, progress, the required monthly
 * contribution, the pace and the forecast date. «Витратити» and closing are row 28. The space is the session's (П-5):
 * a goal of another space is «not found». A scoped member: «бюджет і цілі» are closed by the visibility policy's default
 * (00-general «Область доступу») — not found on reads, and changes need `household.data.write`, which a scoped member
 * never has. Behind the release flag `goals.savings` (ships off) under the feature key of the same name; no plan limit
 * («Кількість активних цілей не обмежена»).
 */
const MODULE = "goals";
const FEATURE = "goals.savings";
const BODY_LIMIT = 4 * 1024;

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const moneyInput = z
  .object({
    amount: z
      .string()
      .max(48)
      .meta({ description: "A plain non-negative decimal, at most the currency's minor units" }),
    currency: z.string().max(10).meta({ description: "ISO 4217 code" }),
  })
  .strict();
const isoDate = z.string().max(10).meta({ description: "YYYY-MM-DD" });

/** «Де лежать гроші» — exactly one part (FR 2, AC9): there is no list of parts to add a second one to. */
const partInput = z
  .object({
    kind: z.enum(PART_KINDS),
    /** «Окремий рахунок цілі» and «Частина рахунку (конверт)» only: a cash account of the space. */
    accountId: z.uuid().nullable().optional(),
    /** In the goal's currency; 0 by default; always 0 for an own account (its balance is what is collected). */
    startAmount: z.string().max(48).optional(),
  })
  .strict();

const goalFields = {
  template: z.enum(GOAL_TEMPLATES),
  name: z.string().max(NAME_MAX * 4),
  target: moneyInput,
  /** Optional; never before today when set or changed (a past one may stay: FR 12). */
  targetDate: isoDate.nullable().optional(),
  /** «Подушка безпеки» only: «Скільки місяців витрат», 3 by default (FR 10). */
  emergencyMonths: z.number().int().nullable().optional(),
  /** Left out (step 2 not opened): one part «Без рахунку — лише позначки» with the start amount 0 (FR 2). */
  part: partInput.optional(),
};

const contributionSchema = z.object({ id: z.uuid(), amount: moneySchema, date: z.string() });

const goalSchema = z.object({
  id: z.uuid(),
  template: z.enum(GOAL_TEMPLATES),
  name: z.string(),
  target: moneySchema,
  targetDate: z.string().nullable(),
  emergencyMonths: z.number().int().nullable(),
  /** The goal always belongs to the space (FR 11): no owner of its own. */
  part: z.object({
    kind: z.enum(PART_KINDS),
    accountId: z.uuid().nullable(),
    startAmount: moneySchema,
    /** An envelope's account: its balance minus every envelope on it (FR 3); negative — they exceed it (edge case 1). */
    freeBalance: moneySchema.nullable(),
  }),
  /** Collected (FR 2): an own account's balance, else the start amount and the contributions. */
  collected: moneySchema,
  /** Rounded down to one decimal: «100.0» only once reached (FR 4). */
  progressPercent: z.string(),
  /** «✓ Досягнуто» (FR 4, FR 13). */
  achieved: z.boolean(),
  /** «+ N € понад ціль»; null unless over the target. */
  overTarget: moneySchema.nullable(),
  /** FR 5: rounded up to a whole unit; null without a date or once it has passed. */
  requiredMonthly: moneySchema.nullable(),
  /** FR 12: the date has passed before the target was reached — offer to extend it, change the amount or close. */
  overdue: z.boolean(),
  /** FR 7: contributions (an own account: the growth of its balance) per month over the last 3 months at most. */
  pace: moneySchema.nullable(),
  /** FR 7: the date the target is reached at the pace; null without a pace or once reached. */
  forecastDate: z.string().nullable(),
  /** FR 5: «уже внесене в цьому місяці» (an own account: the growth of its balance since the month began). */
  contributedThisMonth: moneySchema,
  /** FR 6, AC15: «Внести» — false for an own account, whose card shows the hint to add a transfer instead. */
  canContribute: z.boolean(),
  /** «Історія внесків», newest first; none for an own account. */
  contributions: z.array(contributionSchema),
  createdOn: z.string(),
  version: z.number().int(),
});

const money = (m: Money) => m.toJSON();
const orNull = (m: Money | null) => (m === null ? null : m.toJSON());

function present(v: GoalView): z.input<typeof goalSchema> {
  const { goal: g, progress: p } = v;
  return {
    id: g.id,
    template: g.template,
    name: g.name,
    target: money(g.target),
    targetDate: g.targetDate,
    emergencyMonths: g.emergencyMonths,
    part: {
      kind: g.partKind,
      accountId: g.accountId,
      startAmount: money(g.startAmount),
      freeBalance: orNull(v.freeBalance),
    },
    collected: money(p.collected),
    progressPercent: p.progressPercent,
    achieved: p.achieved,
    overTarget: orNull(p.overTarget),
    requiredMonthly: orNull(p.requiredMonthly),
    overdue: p.overdue,
    pace: orNull(p.pace),
    forecastDate: p.forecastDate,
    contributedThisMonth: money(v.contributedThisMonth),
    canContribute: g.partKind !== "account",
    contributions: v.contributions.map((c) => ({ id: c.id, amount: money(c.amount), date: c.date })),
    createdOn: g.createdOn,
    version: g.version,
  };
}

/** Thrown by a write that found its goal changed after its account's balance was read; the route reads it again. */
class Retry extends Error {
  readonly version: number;
  constructor(version: number) {
    super("goal changed");
    this.version = version;
  }
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
    case "account-taken":
      throw new ApiProblem("GOAL_ACCOUNT_TAKEN");
    case "envelopes-over-balance":
      throw new ApiProblem("GOAL_ENVELOPES_OVER_BALANCE", { extensions: { excess: result.excess.toJSON() } });
    case "own-account":
      throw new ApiProblem("GOAL_OWN_ACCOUNT");
    case "conflict":
      throw new Retry(result.version);
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

/** Every goal of the space as shown; the balances are read after the goals transaction (no pool waits on another). */
async function views(ctx: ProtectedContext): Promise<GoalView[]> {
  const { deps } = goalsServices(ctx);
  const householdId = ctx.principal.householdId;
  const { goals, contributions } = await ctx.inHousehold(async (q) => {
    const tx = goalsTx(q);
    const goals = await tx.goals(householdId);
    return {
      goals,
      contributions: await tx.contributions(
        householdId,
        goals.map((g) => g.id),
      ),
    };
  });
  return viewGoals(deps, householdId, goals, contributions);
}

async function view(ctx: ProtectedContext, id: string): Promise<z.input<typeof goalSchema>> {
  const found = (await views(ctx)).find((v) => v.goal.id === id);
  if (!found) throw new ApiProblem("NOT_FOUND");
  return present(found);
}

/**
 * A write that needs its part's account balance (FR 3): the goal is read, the balance read outside the goals
 * transaction, then the write checks under the row lock that the goal is still that version — else once more, at most
 * three times (then 409 VERSION_CONFLICT). The audit entry follows the commit.
 */
async function handed<T>(
  ctx: ProtectedContext,
  attempt: (stored: StoredGoal) => Promise<Handed<Result<T>>>,
  id: string,
): Promise<T> {
  const { audit } = goalsServices(ctx);
  let version = 0;
  for (let i = 0; i < 3; i++) {
    const stored = await ctx.inHousehold((q) => goalsTx(q).goal(ctx.principal.householdId, id));
    if (!stored) throw new ApiProblem("NOT_FOUND");
    const { result, handOffs } = await attempt(stored);
    await handOffNow(audit, ctx.principal.householdId, handOffs);
    try {
      return value(result);
    } catch (error) {
      if (!(error instanceof Retry)) throw error;
      version = error.version;
    }
  }
  throw new ApiProblem("VERSION_CONFLICT", { extensions: { currentVersion: version } });
}

const goalParams = z.object({ goalId: z.uuid() });

export const listGoalsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/goals",
  operationId: "listGoals",
  summary:
    "«Цілі»: the space's goals with collected, progress, the required monthly contribution and the pace",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description: "The goals, oldest first",
    schema: z.object({ goals: z.array(goalSchema) }),
  },
  handler: async (_input, ctx) => {
    refuseScoped(ctx);
    return { goals: (await views(ctx)).map(present) };
  },
});

export const getGoalRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/goals/{goalId}",
  operationId: "getGoal",
  summary: "The card of one goal; another space's goal is not found",
  access: { permission: "household.data.read", feature: FEATURE },
  request: { params: goalParams },
  response: { status: 200, description: "The goal", schema: goalSchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    return view(ctx, params.goalId);
  },
});

export const createGoalRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/goals",
  operationId: "createGoal",
  summary: "«Створити ціль» with one part «де лежать гроші» (FR 2, FR 3)",
  access: { permission: "household.data.write", feature: FEATURE },
  create: true,
  bodyLimitBytes: BODY_LIMIT,
  problems: ["GOAL_ACCOUNT_TAKEN", "GOAL_ENVELOPES_OVER_BALANCE"],
  request: { body: z.object(goalFields).strict() },
  response: { status: 201, description: "The new goal", schema: goalSchema },
  handler: async ({ body }, ctx) => {
    const { deps, audit } = goalsServices(ctx);
    const checked = checkGoal(body, deps.today());
    const fields = value(checked.kind === "ok" ? { kind: "ok", value: checked.fields } : checked);
    const balance = value(
      await partBalance(deps, ctx.principal.householdId, { ...fields, currency: fields.target.currency }),
    );
    const { result, handOffs } = await ctx.inHousehold((q) =>
      createGoal(deps, goalsTx(q), caller(ctx), fields, balance),
    );
    await handOffNow(audit, ctx.principal.householdId, handOffs);
    return view(ctx, value(result).id);
  },
});

export const updateGoalRoute = defineRoute({
  module: MODULE,
  method: "PATCH",
  path: "/v1/goals/{goalId}",
  operationId: "updateGoal",
  summary: "«Змінити ціль»: the fields sent change, the part too; the currency stays (FR 2, FR 3)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: BODY_LIMIT,
  problems: ["GOAL_ACCOUNT_TAKEN", "GOAL_ENVELOPES_OVER_BALANCE", "VERSION_CONFLICT"],
  request: { params: goalParams, body: z.object(goalFields).partial().strict() },
  response: { status: 200, description: "The goal after the change", schema: goalSchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { deps } = goalsServices(ctx);
    await handed(
      ctx,
      async (stored) => {
        const merged = mergeGoal(stored, body, deps.today());
        if (merged.kind === "invalid") return { result: merged, handOffs: [] };
        const fields = merged.fields;
        const balance = await partBalance(deps, ctx.principal.householdId, {
          ...fields,
          currency: fields.target.currency,
        });
        if (balance.kind !== "ok") return { result: balance, handOffs: [] };
        return ctx.inHousehold((q) =>
          updateGoal(deps, goalsTx(q), caller(ctx), stored.id, stored.version, fields, balance.value),
        );
      },
      params.goalId,
    );
    return view(ctx, params.goalId);
  },
});

export const deleteGoalRoute = defineRoute({
  module: MODULE,
  method: "DELETE",
  path: "/v1/goals/{goalId}",
  operationId: "deleteGoal",
  summary:
    "«Видалити» a goal: its envelope is freed, its history stays in the audit log (FR 13, edge case 4)",
  access: { permission: "household.data.write", feature: FEATURE },
  request: { params: goalParams },
  response: { status: 200, description: "Deleted", schema: z.object({ deleted: z.literal(true) }) },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const { deps, audit } = goalsServices(ctx);
    const { result, handOffs } = await ctx.inHousehold((q) =>
      deleteGoal(deps, goalsTx(q), caller(ctx), params.goalId),
    );
    await handOffNow(audit, ctx.principal.householdId, handOffs);
    value(result);
    return { deleted: true as const };
  },
});

export const contributeRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/goals/{goalId}/contributions",
  operationId: "contributeToGoal",
  summary: "«Внести»: a manual mark of a contribution, over the target too; no money moves (FR 6)",
  access: { permission: "household.data.write", feature: FEATURE },
  create: true,
  bodyLimitBytes: BODY_LIMIT,
  problems: ["GOAL_OWN_ACCOUNT", "GOAL_ENVELOPES_OVER_BALANCE", "VERSION_CONFLICT"],
  request: {
    params: goalParams,
    body: z
      .object({
        /** In the goal's currency, more than 0. */
        amount: moneyInput,
        /** Today by default; never in the future or before the goal was created. */
        date: isoDate.optional(),
      })
      .strict(),
  },
  response: { status: 201, description: "The goal with the contribution", schema: goalSchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { deps } = goalsServices(ctx);
    await handed(
      ctx,
      async (stored) => {
        // Only an envelope's mark reserves its account's balance (FR 3).
        const balance =
          stored.partKind === "envelope"
            ? await partBalance(deps, ctx.principal.householdId, {
                ...stored,
                currency: stored.target.currency,
              })
            : ({ kind: "ok", value: null } as const);
        if (balance.kind !== "ok") return { result: balance, handOffs: [] };
        return ctx.inHousehold((q) =>
          contribute(deps, goalsTx(q), caller(ctx), stored.id, stored.version, body, balance.value),
        );
      },
      params.goalId,
    );
    return view(ctx, params.goalId);
  },
});

export const goalsRoutes = [
  listGoalsRoute,
  getGoalRoute,
  createGoalRoute,
  updateGoalRoute,
  deleteGoalRoute,
  contributeRoute,
];
