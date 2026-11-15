import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { TECHNICAL_LIMITS } from "../../../../platform/http/limits.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import {
  actionReport,
  BulkError,
  previewAction,
  requestUndo,
  resumeAction,
  runPart,
  runUndo,
  startAction,
  type BulkCaller,
  type BulkRequest,
} from "../../application/index.ts";
import { ACTION_STATUSES, SKIP_REASONS } from "../../domain/index.ts";
import { bulkStore } from "../db/store.ts";
import { bulkJobs } from "../queue/jobs.ts";
import { bulkActionsServices } from "./services.ts";

/**
 * Bulk actions (DAT-03@PoC FR 1, FR 3–11; wave 2 row 17 — the server part; the selection panel is row 118): the
 * summary before the run, the run (more than 50 records in the background), the report with «Відмінити» for 24 hours
 * and «Продовжити» after an interruption. The space is the session's (П-5): another space's records are «unavailable»,
 * the same as missing ones, and another space's or another account's action is «not found». A scoped member changes
 * nothing (`household.data.write`) and sees no action. Behind the release flag `data.bulk_actions` (ships off) under
 * the feature key of the same name; no plan limit; at most 500 records (NFR-15 FR 17: 422 LIMIT_REACHED).
 */
const MODULE = "bulk-actions";
const FEATURE = "data.bulk_actions";

const selectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    /** The records ticked by hand (FR 1); more than 500 — 422 LIMIT_REACHED. */
    kind: z.literal("ids"),
    ids: z.array(z.uuid()).min(1).max(5000),
  }),
  z.strictObject({
    /**
     * «Вибрати всі M за фільтром» (FR 1): the list's filter conditions (the list's own `filter` syntax, e.g.
     * `accountId.eq:<id>`) and the records unticked by hand — never the list of ids.
     */
    kind: z.literal("filter"),
    filter: z.array(z.string().min(1).max(512)).max(TECHNICAL_LIMITS.filtersPerRequest),
    excluded: z.array(z.uuid()).max(TECHNICAL_LIMITS.bulkItems).default([]),
  }),
]);

const requestBody = z.strictObject({
  /** The action of the list's «Дії з вибраними» (FR 2), `<entity>.<action>`. */
  action: z
    .string()
    .max(128)
    .regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),
  selection: selectionSchema,
  /** The action's own parameters (e.g. the category), checked by the action. */
  params: z.unknown().optional(),
});

const counts = z.object(
  Object.fromEntries(SKIP_REASONS.map((r) => [r, z.number().int()])) as Record<
    (typeof SKIP_REASONS)[number],
    z.ZodNumber
  >,
);
const skippedRecord = z.object({
  /** The record's id only — never its name or values (AC5). */
  id: z.uuid(),
  reason: z.enum(SKIP_REASONS),
  /** «невалідний»: the code of the single edit's validation. */
  issue: z.string().nullable(),
});

const previewSchema = z.object({
  action: z.string(),
  /** Records of the selection. */
  count: z.number().int(),
  /** «Зміниться N». */
  changes: z.number().int(),
  /** «пропущено M» by reason (FR 4). */
  skipped: counts,
  /** Up to 3 examples of each reason. */
  examples: z.array(skippedRecord),
  /** FR 6: more than 50 records — in the background with «Оброблено X з N». */
  background: z.boolean(),
  /** FR 8: the action can be undone for 24 hours. */
  undoable: z.boolean(),
});

const reportSchema = z.object({
  id: z.uuid(),
  action: z.string(),
  status: z.enum(ACTION_STATUSES).meta({ "x-extensible-enum": true }),
  background: z.boolean(),
  count: z.number().int(),
  /** «Оброблено X з N» (FR 6). */
  processed: z.number().int(),
  changed: z.number().int(),
  skipped: counts,
  /** Every skipped record with its reason (FR 8, AC5). */
  skippedRecords: z.array(skippedRecord),
  undo: z.object({
    /** FR 8: «Відмінити» while the 24-hour window lasts (AC4). */
    available: z.boolean(),
    /** The end of the window (ISO 8601 UTC), for «залишилось …»; null when not available. */
    until: z.string().nullable(),
    /** FR 9, AC3: restored, and «не відновлено» — changed again after the action. */
    restored: z.number().int(),
    notRestored: z.number().int(),
  }),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
});

type Report = Awaited<ReturnType<typeof actionReport>>;

function present(r: Report): z.input<typeof reportSchema> {
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  return {
    id: r.action.id,
    action: r.action.action,
    status: r.action.status,
    background: r.action.background,
    count: r.summary.count,
    processed: r.processed,
    changed: r.summary.changed,
    skipped: r.summary.skipped,
    skippedRecords: r.skippedRecords.map((s) => ({ id: s.recordId, reason: s.reason, issue: s.issue })),
    undo: { ...r.undo, until: iso(r.undo.until) },
    createdAt: new Date(r.action.createdAt).toISOString(),
    endedAt: iso(r.action.endedAt),
  };
}

/** The application's refusals as problems; the messages name no record, count or value of the space. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof BulkError)) throw error;
    switch (error.code) {
      case "UNKNOWN_ACTION":
        throw new ApiProblem("VALIDATION_FAILED", {
          errors: [{ in: "body", path: "action", issue: "unknown" }],
        });
      case "INVALID_PARAMS":
        throw new ApiProblem("VALIDATION_FAILED", {
          errors: [{ in: "body", path: "params", issue: "invalid" }],
        });
      case "INVALID_FILTER":
        throw new ApiProblem("VALIDATION_FAILED", {
          errors: [{ in: "body", path: "selection.filter", issue: "invalid" }],
        });
      case "LIMIT":
        // NFR-15 FR 17, AC10: «не більше 500 записів».
        throw new ApiProblem("LIMIT_REACHED", { extensions: { limit: TECHNICAL_LIMITS.bulkItems } });
      case "NOT_FOUND":
        throw new ApiProblem("NOT_FOUND");
      case "RUNNING":
        throw new ApiProblem("BULK_ACTION_RUNNING");
      case "UNDO_UNAVAILABLE":
        throw new ApiProblem("BULK_UNDO_UNAVAILABLE");
      case "NOT_RESUMABLE":
        throw new ApiProblem("BULK_ACTION_NOT_INTERRUPTED");
    }
    throw error;
  }
}

/** Scoped members see no bulk action (they change nothing; the visibility policy closes the lists by default). */
function callerOf(ctx: ProtectedContext): BulkCaller {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
  return { householdId: ctx.principal.householdId, actorId: ctx.principal.userId, scoped: false };
}

/**
 * Work that follows a committed change at once (a foreground run, an undo): its job is already queued, so a failure
 * here is no failure of the request — the worker finishes it. Logged as `bulk_actions.deferred` (WARN, the error
 * class only).
 */
async function rightAway(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    logEvent("bulk_actions.deferred", "warn", {
      "ws.module": MODULE,
      "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
    });
  }
}

async function reportNow(ctx: ProtectedContext, caller: BulkCaller, actionId: string) {
  const { deps } = bulkActionsServices(ctx);
  return present(await ctx.inHousehold((q) => actionReport(deps, bulkStore(q), caller, actionId)));
}

const params = z.object({ actionId: z.uuid() });
const BODY_LIMIT = 256 * 1024;
const PROBLEMS = ["LIMIT_REACHED", "BULK_ACTION_RUNNING"] as const;

export const previewBulkActionRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/bulk-actions/preview",
  operationId: "previewBulkAction",
  summary:
    "The summary before a bulk action (FR 3): how many records change, how many are skipped and why; writes nothing",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: BODY_LIMIT,
  problems: ["LIMIT_REACHED"],
  request: { body: requestBody },
  response: { status: 200, description: "The summary", schema: previewSchema },
  handler: async ({ body }, ctx) => {
    const caller = callerOf(ctx);
    const { deps } = bulkActionsServices(ctx);
    const preview = await guarded(() => previewAction(deps, caller, body as BulkRequest));
    return {
      ...preview,
      examples: preview.examples.map((e) => ({ id: e.recordId, reason: e.reason, issue: e.issue })),
    };
  },
});

export const startBulkActionRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/bulk-actions",
  operationId: "startBulkAction",
  summary:
    "Runs a bulk action: up to 50 records at once, more in the background with «Оброблено X з N»; one at a time per account",
  access: { permission: "household.data.write", feature: FEATURE },
  create: true,
  // #272 item 3: another account of the space repeating the key and the body gets no report of the first's action.
  idempotencyScope: "account",
  bodyLimitBytes: BODY_LIMIT,
  problems: [...PROBLEMS],
  request: { body: requestBody },
  response: { status: 201, description: "The action's report", schema: reportSchema },
  handler: async ({ body }, ctx) => {
    const caller = callerOf(ctx);
    const { deps } = bulkActionsServices(ctx);
    const action = await guarded(() =>
      ctx.inHousehold((q) => startAction(deps, bulkStore(q), bulkJobs(q), caller, body as BulkRequest)),
    );
    if (!action.background)
      await rightAway(() =>
        ctx.inHousehold((q) =>
          runPart(
            deps,
            bulkStore(q),
            bulkJobs(q),
            caller.householdId,
            { actionId: action.id, run: 1, part: 1, attempt: 1 },
            Number.POSITIVE_INFINITY,
          ),
        ),
      );
    return reportNow(ctx, caller, action.id);
  },
});

export const getBulkActionRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/bulk-actions/{actionId}",
  operationId: "getBulkAction",
  summary:
    "The report of the caller's bulk action: progress, counts with reasons, «Відмінити» and the time left",
  access: { permission: "household.data.read", feature: FEATURE },
  request: { params },
  response: { status: 200, description: "The action's report", schema: reportSchema },
  handler: async ({ params }, ctx) => guarded(() => reportNow(ctx, callerOf(ctx), params.actionId)),
});

export const undoBulkActionRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/bulk-actions/{actionId}/undo",
  operationId: "undoBulkAction",
  summary:
    "«Відмінити» within 24 hours: previous values back on the records nobody changed since; the others «не відновлено»",
  access: { permission: "household.data.write", feature: FEATURE },
  problems: ["BULK_UNDO_UNAVAILABLE"],
  request: { params },
  response: { status: 200, description: "The action's report", schema: reportSchema },
  handler: async ({ params }, ctx) => {
    const caller = callerOf(ctx);
    const { deps } = bulkActionsServices(ctx);
    await guarded(() =>
      ctx.inHousehold((q) => requestUndo(deps, bulkStore(q), bulkJobs(q), caller, params.actionId)),
    );
    await rightAway(() =>
      ctx.inHousehold((q) => runUndo(deps, bulkStore(q), bulkJobs(q), caller.householdId, params.actionId)),
    );
    return reportNow(ctx, caller, params.actionId);
  },
});

export const resumeBulkActionRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/bulk-actions/{actionId}/resume",
  operationId: "resumeBulkAction",
  summary: "«Продовжити» an interrupted bulk action: the records not done yet, in the background",
  access: { permission: "household.data.write", feature: FEATURE },
  problems: ["BULK_ACTION_RUNNING", "BULK_ACTION_NOT_INTERRUPTED"],
  request: { params },
  response: { status: 200, description: "The action's report", schema: reportSchema },
  handler: async ({ params }, ctx) => {
    const caller = callerOf(ctx);
    bulkActionsServices(ctx);
    await guarded(() =>
      ctx.inHousehold((q) => resumeAction(bulkStore(q), bulkJobs(q), caller, params.actionId)),
    );
    return reportNow(ctx, caller, params.actionId);
  },
});

export const bulkActionsRoutes = [
  previewBulkActionRoute,
  startBulkActionRoute,
  getBulkActionRoute,
  undoBulkActionRoute,
  resumeBulkActionRoute,
];
