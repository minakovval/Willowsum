import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import {
  attentionOf,
  matchingTransactions,
  memoized,
  reportOf,
  runPart,
  startRun,
  startUndo,
  RUN_PART_SIZE,
  type RunReport,
} from "../../application/index.ts";
import { RUN_FOREGROUND_MAX } from "../../domain/index.ts";
import { rulesTx } from "../db/rules.ts";
import { runsTx } from "../db/runs.ts";
import { categorizationTx } from "../db/store.ts";
import { categorizationServices, rulesAuditNow } from "./services.ts";

/**
 * «Застосувати до N наявних транзакцій, що підходять» and «Відмінити» (BUD-14@PoC FR 7, AC2, AC4–AC6, AC15, EC1, EC5;
 * wave 2 row 23 b2): a run of a rule over the existing transactions it matches as one operation — up to 500 at once,
 * the rest in the background with «Оброблено X з N»; «Відмінити» for 7 days. Same access as the rules
 * (adapters/http/rules.ts): the space is the session's, a run of another space is «not found», a scoped member — 404.
 */
const MODULE = "categorization";
const FEATURE = "categorization.rules";

export const reportSchema = z.object({
  id: z.uuid(),
  ruleId: z.uuid(),
  /** `running` — «Оброблено X з N»; `completed`; `undoing` — «Відмінити» in the background; `undone`. */
  status: z.enum(["running", "completed", "undoing", "undone"]),
  /** More than 500: the rest in the background (EC1). */
  background: z.boolean(),
  /**
   * BUD-21 FR 22 (row 237): the derivation whose accepted suggestions this run applies (each transaction by the first
   * accepted rule that sets it; `ruleId` is the first of them); null — a run of one rule.
   */
  derivationId: z.uuid().nullable(),
  /** N: the transactions the rule matched when the run began. */
  count: z.number().int(),
  /** X of «Оброблено X з N». */
  processed: z.number().int(),
  /** The transactions whose category or tags the run changed. */
  changed: z.number().int(),
  skipped: z.object({
    /** «Пропущено: ручні зміни (N)»: the category set by hand stays (FR 9; the rule's tags still apply). */
    manual: z.number().int(),
    /** Already as the rule sets it. */
    unchanged: z.number().int(),
    /** Gone, hidden, split, merged or a side of a transfer by now, or the rule deleted meanwhile. */
    unavailable: z.number().int(),
  }),
  /** Only the newest transactions of the space were matched (the bound of «Показати»). */
  truncated: z.boolean(),
  undo: z.object({
    /** «Відмінити» is there: up to 7 days after the end, once. */
    available: z.boolean(),
    until: z.iso.datetime().nullable(),
    /** The records given their values back. */
    restored: z.number().int(),
    /** EC5: changed since the run — kept as they are, «не відновлено». */
    notRestored: z.number().int(),
  }),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

const present = (r: RunReport): z.input<typeof reportSchema> => ({
  id: r.run.id,
  ruleId: r.run.ruleId,
  derivationId: r.run.derivationId ?? null,
  status: r.run.status,
  background: r.run.count > RUN_FOREGROUND_MAX,
  count: r.run.count,
  processed: r.counts.processed,
  changed: r.counts.changed,
  skipped: { manual: r.counts.manual, unchanged: r.counts.unchanged, unavailable: r.counts.unavailable },
  truncated: r.run.truncated,
  undo: {
    available: r.undo.available,
    until: iso(r.undo.until),
    restored: r.counts.restored,
    notRestored: r.counts.notRestored,
  },
  createdAt: iso(r.run.createdAt)!,
  endedAt: iso(r.run.endedAt),
});

function refuseScoped(ctx: { principal: { scoped: boolean } }): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

function runDeps(ctx: ProtectedContext) {
  const services = categorizationServices(ctx);
  if (!services.rules) throw new ApiProblem("INTERNAL");
  return { services, deps: services.rules.deps };
}

export async function report(ctx: ProtectedContext, runId: string): Promise<z.input<typeof reportSchema>> {
  const { services } = runDeps(ctx);
  const householdId = ctx.principal.householdId;
  const found = await ctx.inHousehold(async (q) => {
    const run = await runsTx(q).run(householdId, runId);
    return run ? { run, counts: await runsTx(q).counts(householdId, runId) } : null;
  });
  if (!found) throw new ApiProblem("NOT_FOUND");
  return present(reportOf(found.run, found.counts, services.clock.now()));
}

/** The parts of the request: until 500 records are processed (EC1) or the step is done; the worker does the rest. */
export async function foreground(ctx: ProtectedContext, runId: string): Promise<void> {
  const { services, deps } = runDeps(ctx);
  const householdId = ctx.principal.householdId;
  for (let taken = 0; taken < RUN_FOREGROUND_MAX; taken += RUN_PART_SIZE) {
    const part = await ctx.inHousehold((q) =>
      runPart(categorizationTx(q), rulesTx(q), runsTx(q), deps, {
        householdId,
        runId,
        limit: RUN_PART_SIZE,
        now: services.clock.now(),
        chain: false,
      }),
    );
    await rulesAuditNow(services.rulesAudit, householdId, part.audit);
    if (part.done) return;
  }
}

const ruleParams = z.object({ ruleId: z.uuid() });
const runParams = z.object({ runId: z.uuid() });

export const applyCategoryRuleRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/category-rules/{ruleId}/apply",
  operationId: "applyCategoryRule",
  summary:
    "«Застосувати до N наявних транзакцій, що підходять»: one operation — up to 500 at once, the rest in the background; manual categories skipped (BUD-14 FR 7, FR 9)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 1024,
  problems: ["RULE_RUN_RUNNING", "RULE_NEEDS_ATTENTION"],
  request: { params: ruleParams, body: z.object({}).strict() },
  response: { status: 201, description: "The run", schema: reportSchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const { services, deps } = runDeps(ctx);
    const householdId = ctx.principal.householdId;
    const rule = (await ctx.inHousehold((q) => rulesTx(q).rules(householdId))).find(
      (r) => r.id === params.ruleId,
    );
    if (!rule) throw new ApiProblem("NOT_FOUND");
    // FR 10: a rule that needs attention is skipped until it is edited — here too.
    if ((await attentionOf(memoized(deps), householdId, rule)) !== null)
      throw new ApiProblem("RULE_NEEDS_ATTENTION");
    const matches = await matchingTransactions(deps, householdId, rule, services.scanMax);
    const started = await ctx.inHousehold((q) =>
      startRun(rulesTx(q), runsTx(q), {
        householdId,
        actorAccountId: ctx.principal.userId,
        id: randomUUID(),
        ruleId: rule.id,
        transactionIds: matches.ids,
        truncated: matches.truncated,
        now: services.clock.now(),
      }),
    );
    if (started.kind === "not-found") throw new ApiProblem("NOT_FOUND");
    if (started.kind === "running") throw new ApiProblem("RULE_RUN_RUNNING");
    await foreground(ctx, started.run.id);
    return report(ctx, started.run.id);
  },
});

export const listCategoryRuleRunsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/category-rule-runs",
  operationId: "listCategoryRuleRuns",
  summary:
    "The space's runs of «Застосувати до N наявних…», newest first (at most 20), for «Відмінити» (BUD-14 FR 7)",
  access: { permission: "household.data.read", feature: FEATURE },
  response: { status: 200, description: "The runs", schema: z.object({ items: z.array(reportSchema) }) },
  handler: async (_input, ctx) => {
    refuseScoped(ctx);
    const { services } = runDeps(ctx);
    const householdId = ctx.principal.householdId;
    const found = await ctx.inHousehold(async (q) => {
      const out = [];
      for (const run of await runsTx(q).runs(householdId, 20))
        out.push({ run, counts: await runsTx(q).counts(householdId, run.id) });
      return out;
    });
    const now = services.clock.now();
    return { items: found.map((f) => present(reportOf(f.run, f.counts, now))) };
  },
});

export const getCategoryRuleRunRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/category-rule-runs/{runId}",
  operationId: "getCategoryRuleRun",
  summary: "A run of a rule: «Оброблено X з N», «Пропущено: ручні зміни», «Відмінити» (BUD-14 FR 7)",
  access: { permission: "household.data.read", feature: FEATURE },
  request: { params: runParams },
  response: { status: 200, description: "The run", schema: reportSchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    return report(ctx, params.runId);
  },
});

export const undoCategoryRuleRunRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/category-rule-runs/{runId}/undo",
  operationId: "undoCategoryRuleRun",
  summary:
    "«Відмінити» a run for 7 days: only values the run changed and nobody changed since come back (BUD-14 FR 7, AC6, EC5)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 1024,
  problems: ["RULE_RUN_RUNNING", "RULE_RUN_UNDO_EXPIRED", "RULE_RUN_UNDONE"],
  request: { params: runParams, body: z.object({}).strict() },
  response: { status: 200, description: "The run", schema: reportSchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const { services } = runDeps(ctx);
    const householdId = ctx.principal.householdId;
    const result = await ctx.inHousehold((q) =>
      startUndo(runsTx(q), {
        householdId,
        actorAccountId: ctx.principal.userId,
        runId: params.runId,
        now: services.clock.now(),
      }),
    );
    if (result.kind === "not-found") throw new ApiProblem("NOT_FOUND");
    if (result.kind === "running") throw new ApiProblem("RULE_RUN_RUNNING");
    if (result.kind === "expired") throw new ApiProblem("RULE_RUN_UNDO_EXPIRED");
    if (result.kind === "undone") throw new ApiProblem("RULE_RUN_UNDONE");
    await foreground(ctx, params.runId);
    return report(ctx, params.runId);
  },
});

export const runsRoutes = [
  listCategoryRuleRunsRoute,
  getCategoryRuleRunRoute,
  applyCategoryRuleRoute,
  undoCategoryRuleRunRoute,
];
