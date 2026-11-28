import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import {
  acceptancePlan,
  acceptedRules,
  acceptSuggestions,
  checkRule,
  DerivationSourceMissing,
  executeDerivation,
  existingMatches,
  rejectSuggestion,
  RunRunning,
  shownSuggestions,
  startDerivation,
  withTransferCategory,
  type AcceptItem,
  type AcceptResult,
  type DerivationDeps,
  type DerivationRun,
  type DerivationsRun,
  type HistorySourceRow,
  type RulesAuditLog,
  type ShownSuggestion,
} from "../../application/index.ts";
import {
  DERIVATION_FOREGROUND_MAX,
  HISTORY_CHECK_MIN_ROWS,
  ruleConditions,
  RULES_MAX,
} from "../../domain/index.ts";
import { derivationsTx } from "../db/derivations.ts";
import { rulesTx } from "../db/rules.ts";
import { runsTx } from "../db/runs.ts";
import { conditionsIn, matcherFields, tagsSchema } from "./rules.ts";
import { foreground, report, reportSchema } from "./runs.ts";
import { categorizationServices, rulesAuditNow } from "./services.ts";

/**
 * The derivation of rules from a history file (BUD-21@PoC FR 10–15, FR 17, EC10; wave 2 row 235): started for a
 * confirmed history batch (and by its confirmation, module import-sessions), up to 2 000 rows in the request, more in
 * the background with «оброблено X з N рядків»; a start while one runs shows that one. The suggestions of a completed
 * run with their evidence and «винятки у файлі». The space is the session's: a batch or a run of another space is «not
 * found»; a scoped member — 404 (Owner only in PoC). Behind the release flag `categorization.history-rules` under the
 * feature key of the same name, as the history file; no plan limit.
 */
const MODULE = "categorization";
const FEATURE = "categorization.history-rules";
/**
 * FR 22 (row 237): the acceptance writes category rules — behind their flag `categorization.rules` too, checked in the
 * handler (a route's own flag must require its feature; this one requires `transactions.merchants`): off — not found.
 */
async function rulesOn(ctx: ProtectedContext): Promise<void> {
  if (!(await categorizationServices(ctx).rulesEnabled(ctx.principal.householdId)))
    throw new ApiProblem("NOT_FOUND");
}

/** At most this many evidence rows and exceptions per suggestion in one answer (the counts are whole). */
export const SUGGESTION_ROWS_LISTED = 100;

const runSchema = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  /** `running` — «оброблено X з N рядків»; `completed`; `failed` — the file's rows were gone («Повторити»). */
  status: z.enum(["running", "completed", "failed"]),
  /** FR 10: more than 2 000 rows — in the background. */
  background: z.boolean(),
  /** N: the categorised rows of the file. */
  count: z.number().int(),
  /** X of «оброблено X з N рядків». */
  processed: z.number().int(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});

const conditionSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("merchant"), operator: z.literal("equals"), value: z.string() }),
  z.object({ field: z.literal("description"), operator: z.literal("contains"), value: z.string() }),
  z.object({
    field: z.literal("amount"),
    operator: z.enum(["greater", "less"]),
    value: z.object({ amount: z.string(), currency: z.string() }),
  }),
  z.object({ field: z.literal("account"), operator: z.literal("equals"), value: z.uuid() }),
]);

const fileRowSchema = z.object({
  /** The file's row, from 1. */
  row: z.number().int(),
  date: z.iso.date(),
  /** Signed decimal text in `currency`. */
  amount: z.string(),
  currency: z.string().nullable(),
  /** An IBAN or a card number masked to its last 4 characters. */
  description: z.string().nullable(),
  /** The space's category the row's label became. */
  categoryId: z.uuid(),
});

const suggestionSchema = z.object({
  /** The position in the order of the suggestions (FR 20's order of accepted rules). */
  ordinal: z.number().int(),
  /** FR 13: «Впевнена» or «Суперечлива». */
  kind: z.enum(["confident", "conflicting"]),
  /**
   * FR 16, FR 21 (row 236): `transfer` — a suggestion of the group «Переказ», its action «категорія „Переказ“»
   * (`categoryId` is the space's «Переказ»); its rule never makes a transaction a transfer by itself, it puts it on
   * «Пари» as a one-sided transfer awaiting confirmation. `category` — any other.
   */
  action: z.enum(["category", "transfer"]),
  /** FR 11: the rule editor's conditions, all through «І». */
  conditions: z.array(conditionSchema),
  categoryId: z.uuid(),
  /** FR 13 N: the rows that match the conditions. */
  matched: z.number().int(),
  /** How many of them have the suggestion's category. */
  agreeing: z.number().int(),
  /** FR 15: from this date the user files such rows under the new category; null — no change. */
  since: z.iso.date().nullable(),
  /** FR 17: the action «теги» — created at acceptance when missing. */
  tags: z.array(z.string()),
  /** The evidence: the file's rows with the suggestion's category (row numbers, the first 100). */
  evidence: z.object({ rows: z.array(z.number().int()), more: z.boolean() }),
  /** FR 14: «винятки у файлі» — matching rows of another category (the first 100); nothing needs correcting. */
  exceptions: z.object({ items: z.array(fileRowSchema), count: z.number().int() }),
  /** FR 19, AC21 (row 237): how many existing transactions of the space its conditions match. */
  existing: z.number().int(),
  /**
   * FR 20, AC23: the rule of the space with the same conditions and another category («суперечить правилу №…»); null —
   * none. A rule with the same conditions and category hides the suggestion (AC22).
   */
  conflict: z.object({ ruleId: z.uuid(), position: z.number().int() }).nullable(),
  /** FR 21: selected by default — confident, not conflicting with a rule, its category there. */
  selected: z.boolean(),
  /** EC8: the category was deleted — the acceptance refuses it (a merged one is shown as its target). */
  categoryDeleted: z.boolean(),
});

/** FR 18, AC20 (row 237): «перевірка на історії» over the suggestions; null — derived before it existed, or running. */
const checkSchema = z.object({
  /** `ready` — the coverage and the agreement; `too_short` — under `minimum` rows: «історії замало». */
  status: z.enum(["ready", "too_short"]),
  /** `ready`: the latest 20 % of the rows by date; `too_short`: the rows with a category or a transfer mark. */
  rows: z.number().int(),
  /** The coverage: of `rows`, those a rule derived from the earlier 80 % gave a category; null — `too_short`. */
  covered: z.number().int().nullable(),
  /** The agreement: of `covered`, those whose category is the user's; null — `too_short`. */
  agreeing: z.number().int().nullable(),
  minimum: z.number().int(),
});

/** FR 19, AC21 (row 237): the suggestions against the existing transactions of the space. */
const existingSchema = z.object({
  /** The transactions imported from statements (among the newest 20 000 the rules look at). */
  imported: z.number().int(),
  /** Of them, those any suggestion matches. */
  matched: z.number().int(),
  /** «описи у файлі, схоже, відрізняються від описів банку»: at least 50 imported, under 10 % matched. */
  descriptionsDiffer: z.boolean(),
  /** Only the newest 20 000 transactions of the space were read. */
  truncated: z.boolean(),
});

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export const presentRun = (r: DerivationRun): z.input<typeof runSchema> => ({
  id: r.id,
  batchId: r.batchId,
  status: r.status,
  background: r.count > DERIVATION_FOREGROUND_MAX,
  count: r.count,
  processed: r.processed,
  createdAt: iso(r.createdAt)!,
  endedAt: iso(r.endedAt),
});

const presentCheck = (r: DerivationRun): z.input<typeof checkSchema> | null =>
  !r.check
    ? null
    : r.check.status === "ready"
      ? { ...r.check, minimum: HISTORY_CHECK_MIN_ROWS }
      : {
          status: "too_short",
          rows: r.check.rows,
          covered: null,
          agreeing: null,
          minimum: HISTORY_CHECK_MIN_ROWS,
        };

function presentSuggestion(
  s: ShownSuggestion,
  rows: ReadonlyMap<number, HistorySourceRow & { readonly categoryId: string }>,
  existing: number,
): z.input<typeof suggestionSchema> {
  return {
    ordinal: s.ordinal,
    kind: s.kind,
    action: s.transfer ? "transfer" : "category",
    conditions: s.conditions.map((c) => ({ ...c })),
    categoryId: s.categoryId,
    matched: s.matched,
    agreeing: s.agreeing,
    since: s.since,
    tags: [...s.tags],
    evidence: { rows: s.rows.slice(0, SUGGESTION_ROWS_LISTED), more: s.rows.length > SUGGESTION_ROWS_LISTED },
    exceptions: {
      count: s.exceptions.length,
      items: s.exceptions.slice(0, SUGGESTION_ROWS_LISTED).flatMap((n) => {
        const r = rows.get(n);
        return r
          ? [
              {
                row: r.row,
                date: r.date,
                amount: r.amount,
                currency: r.currency,
                description: r.shown,
                categoryId: r.categoryId,
              },
            ]
          : [];
      }),
    },
    existing,
    conflict: s.conflict === null ? null : { ruleId: s.conflict.id, position: s.conflict.position },
    selected: s.selected,
    categoryDeleted: s.categoryDeleted,
  };
}

/**
 * FR 10, EC10, FR 26: a start — the run (or the one already running), its audit entry right away (else the worker's),
 * and up to 2 000 rows derived before the answer. Also module import-sessions' port at the confirmation
 * (`createHistoryDerivations`).
 */
export async function startAndDerive(
  deps: DerivationDeps,
  inSpace: DerivationsRun,
  audit: RulesAuditLog,
  input: { readonly householdId: string; readonly actorAccountId: string; readonly batchId: string },
): Promise<{ readonly run: DerivationRun; readonly started: boolean }> {
  const started = await startDerivation(deps, inSpace, input);
  await rulesAuditNow(audit, input.householdId, started.audit);
  if (!started.started || started.run.count > DERIVATION_FOREGROUND_MAX) return started;
  await executeDerivation(deps, inSpace, input.householdId, started.run.id, started.rows);
  const run = await inSpace(input.householdId, (tx) => tx.run(input.householdId, started.run.id));
  return { run: run ?? started.run, started: true };
}

function derivationServices(ctx: ProtectedContext) {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
  const services = categorizationServices(ctx);
  if (!services.derivations) throw new ApiProblem("INTERNAL");
  // The session's space: every unit of work is bound to it (the `householdId` argument is that space).
  const inSpace: DerivationsRun = (_householdId, work) => ctx.inHousehold((q) => work(derivationsTx(q)));
  return { services, deps: services.derivations, inSpace };
}

export const startHistoryDerivationRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/category-rule-derivations",
  operationId: "startHistoryDerivation",
  summary:
    "Derive rule suggestions from a confirmed history file: up to 2 000 rows at once, more in the background; while one runs, that one (BUD-21 FR 10, EC10)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 1024,
  request: { body: z.strictObject({ batchId: z.uuid() }) },
  response: {
    status: 201,
    description: "The derivation; `started` false — the one already running for the file",
    schema: z.object({ derivation: runSchema, started: z.boolean() }),
  },
  handler: async ({ body }, ctx) => {
    const { services, deps, inSpace } = derivationServices(ctx);
    try {
      const { run, started } = await startAndDerive(deps, inSpace, services.rulesAudit, {
        householdId: ctx.principal.householdId,
        actorAccountId: ctx.principal.userId,
        batchId: body.batchId,
      });
      return { derivation: presentRun(run), started };
    } catch (error) {
      if (error instanceof DerivationSourceMissing) throw new ApiProblem("NOT_FOUND");
      throw error;
    }
  },
});

/**
 * A derivation of the space with what the page shows of it (FR 20, FR 23, EC8): the run, its suggestions as shown
 * and the space's rules. Not found — another space's, or its history file is gone (FR 24).
 */
async function loaded(ctx: ProtectedContext, derivationId: string) {
  const { services, deps } = derivationServices(ctx);
  if (!services.rules) throw new ApiProblem("INTERNAL");
  const householdId = ctx.principal.householdId;
  const found = await ctx.inHousehold(async (q) => {
    const tx = derivationsTx(q);
    const run = await tx.run(householdId, derivationId);
    if (!run) return null;
    return {
      run,
      stored: await tx.suggestions(householdId, run.id),
      rules: await rulesTx(q).rules(householdId),
      rejected: await tx.rejections(householdId),
    };
  });
  if (!found) throw new ApiProblem("NOT_FOUND");
  // FR 24: the suggestions are the file's — once its batch is gone they are gone too.
  if (!(await deps.source.existing(householdId, [found.run.batchId])).has(found.run.batchId))
    throw new ApiProblem("NOT_FOUND");
  const shown = await shownSuggestions(
    services.deps.categories,
    householdId,
    found.stored,
    found.rules,
    found.rejected,
  );
  return { ...found, shown, services, deps, rules: services.rules.deps };
}

export const getHistoryDerivationRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/category-rule-derivations/{derivationId}",
  operationId: "getHistoryDerivation",
  summary:
    "A derivation: «оброблено X з N рядків» and, once completed, the check on the history and its suggestions with evidence, exceptions, existing matches and conflicts with rules (BUD-21 FR 10–20)",
  access: { permission: "household.data.read", feature: FEATURE },
  request: { params: z.object({ derivationId: z.uuid() }) },
  response: {
    status: 200,
    description: "The derivation and its suggestions as shown (empty until completed)",
    schema: z.object({
      derivation: runSchema,
      check: checkSchema.nullable(),
      existing: existingSchema.nullable(),
      suggestions: z.array(suggestionSchema),
    }),
  },
  handler: async ({ params }, ctx) => {
    const found = await loaded(ctx, params.derivationId);
    const householdId = ctx.principal.householdId;
    const derivation = presentRun(found.run);
    const check = presentCheck(found.run);
    if (found.shown.length === 0) return { derivation, check, existing: null, suggestions: [] };
    const rows = await found.deps.source.rows(householdId, found.run.batchId);
    if (rows === null) throw new ApiProblem("NOT_FOUND");
    const byRow = new Map(
      withTransferCategory(rows, await found.deps.transferCategory(householdId)).map((r) => [r.row, r]),
    );
    const matches = await existingMatches(
      found.rules,
      householdId,
      found.shown.map((s) => ruleConditions(s.conditions)),
      found.services.scanMax,
    );
    return {
      derivation,
      check,
      existing: {
        imported: matches.imported,
        matched: matches.matchedImported,
        descriptionsDiffer: matches.descriptionsDiffer,
        truncated: matches.truncated,
      },
      suggestions: found.shown.map((s, i) => presentSuggestion(s, byRow, matches.counts[i]!)),
    };
  },
});

export const listHistoryDerivationsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/category-rule-derivations",
  operationId: "listHistoryDerivations",
  summary:
    "The latest derivation of each history file the space stores, with how many suggestions are not accepted yet — the count on «Правила категорій» (BUD-14 FR 16, BUD-21 FR 21)",
  access: { permission: "household.data.read", feature: FEATURE },
  response: {
    status: 200,
    description:
      "The derivations, newest first, and the suggestions not accepted, rejected or covered by a rule",
    schema: z.object({
      items: z.array(z.object({ derivation: runSchema, pending: z.number().int() })),
      pending: z.number().int(),
    }),
  },
  handler: async (_input, ctx) => {
    const { services, deps } = derivationServices(ctx);
    const householdId = ctx.principal.householdId;
    const found = await ctx.inHousehold(async (q) => {
      const tx = derivationsTx(q);
      const runs = await tx.latestPerBatch(householdId);
      const stored = [];
      for (const run of runs)
        stored.push(run.status === "completed" ? await tx.suggestions(householdId, run.id) : []);
      return {
        runs,
        stored,
        rules: await rulesTx(q).rules(householdId),
        rejected: await tx.rejections(householdId),
      };
    });
    const kept =
      found.runs.length === 0
        ? new Set<string>()
        : await deps.source.existing(
            householdId,
            found.runs.map((r) => r.batchId),
          );
    const items = [];
    for (const [i, run] of found.runs.entries()) {
      if (!kept.has(run.batchId)) continue;
      const shown = await shownSuggestions(
        services.deps.categories,
        householdId,
        found.stored[i]!,
        found.rules,
        found.rejected,
      );
      items.push({ derivation: presentRun(run), pending: shown.length });
    }
    return { items, pending: items.reduce((sum, i) => sum + i.pending, 0) };
  },
});

/** FR 21, FR 22: a suggestion to accept — its ordinal and, after the pencil, the rule as changed (BUD-14 FR 5). */
const acceptItemSchema = z.strictObject({
  ordinal: z.number().int().min(1),
  /** FR 21: the suggestion as the dialog «Правило категорії» changed it; absent — as derived. */
  rule: z
    .strictObject({
      ...matcherFields,
      accountIds: matcherFields.accountIds.default([]),
      categoryId: z.uuid(),
      tags: tagsSchema.default([]),
    })
    .optional(),
});

const acceptItemsSchema = z.array(acceptItemSchema).min(1).max(RULES_MAX);

type AcceptItemInput = z.infer<typeof acceptItemSchema>;

const accepting = (items: readonly AcceptItemInput[]): AcceptItem[] =>
  items.map((i) => ({
    ordinal: i.ordinal,
    ...(i.rule
      ? {
          edited: {
            conditions: conditionsIn(i.rule.conditions),
            accountIds: i.rule.accountIds,
            categoryId: i.rule.categoryId,
            tags: i.rule.tags,
          },
        }
      : {}),
  }));

/**
 * FR 22, EC8: the rules of an acceptance from the shown suggestions — the problems of an unknown or repeated ordinal,
 * a deleted category, or a changed rule the editor would refuse. A changed rule keeps «категорія „Переказ“» only as
 * its suggestion's own.
 */
async function acceptance(
  found: Awaited<ReturnType<typeof loaded>>,
  householdId: string,
  items: AcceptItem[],
) {
  if (found.run.status !== "completed") throw new ApiProblem("HISTORY_DERIVATION_NOT_COMPLETED");
  const result = await acceptedRules(found.shown, items, randomUUID, async (edited, s) => {
    const keepsTransfer = s.transfer && edited.categoryId === s.categoryId;
    const issue = await checkRule(found.rules, householdId, {
      ...(keepsTransfer ? {} : { categoryId: edited.categoryId }),
      accountIds: edited.accountIds,
      conditions: edited.conditions,
    });
    return issue === null ? null : { path: `rule.${issue.path}`, issue: issue.issue };
  });
  if ("kind" in result) {
    const index = items.findIndex((i) => result.kind === "category-deleted" && i.ordinal === result.ordinal);
    if (result.kind === "category-deleted")
      throw new ApiProblem("HISTORY_SUGGESTION_CATEGORY_DELETED", {
        errors: [{ in: "body", path: `suggestions.${index}.ordinal`, issue: "category_deleted" }],
      });
    throw new ApiProblem("VALIDATION_FAILED", {
      errors: [{ in: "body", path: result.path, issue: result.issue }],
    });
  }
  return result.rules;
}

const derivationParams = z.object({ derivationId: z.uuid() });

export const matchHistorySuggestionsRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/category-rule-derivations/{derivationId}/matches",
  operationId: "matchHistorySuggestions",
  summary:
    "«Застосувати до N наявних транзакцій, що підходять» of the acceptance dialog: N for the selected suggestions, each transaction counted once (BUD-21 FR 22)",
  access: { permission: "household.data.read", feature: FEATURE },
  bodyLimitBytes: 256 * 1024,
  problems: ["HISTORY_DERIVATION_NOT_COMPLETED", "HISTORY_SUGGESTION_CATEGORY_DELETED"],
  request: { params: derivationParams, body: z.strictObject({ suggestions: acceptItemsSchema }) },
  response: {
    status: 200,
    description: "N, and the transactions a rule «Переказ» would leave as they are",
    schema: z.object({
      /** The existing transactions the accepted rules would apply to (the manual ones are skipped then). */
      count: z.number().int(),
      /** Lead decision (row 237): matched first by a rule «категорія „Переказ“» — left as they are. */
      transfers: z.number().int(),
      truncated: z.boolean(),
    }),
  },
  handler: async ({ params, body }, ctx) => {
    await rulesOn(ctx);
    const found = await loaded(ctx, params.derivationId);
    const householdId = ctx.principal.householdId;
    const rules = await acceptance(found, householdId, accepting(body.suggestions));
    const plan = await acceptancePlan(found.rules, householdId, rules, found.services.scanMax);
    return { count: plan.transactionIds.length, transfers: plan.transfers, truncated: plan.truncated };
  },
});

export const acceptHistorySuggestionsRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/category-rule-derivations/{derivationId}/accept",
  operationId: "acceptHistorySuggestions",
  summary:
    "Accept suggestions: ordinary rules «з історії» below the existing ones in the order of FR 20, their missing tags created; with `apply`, one run over the existing transactions with «Відмінити» for 7 days (BUD-21 FR 20, FR 22, EC8)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 256 * 1024,
  problems: [
    "LIMIT_REACHED",
    "RULE_RUN_RUNNING",
    "HISTORY_DERIVATION_NOT_COMPLETED",
    "HISTORY_SUGGESTION_CATEGORY_DELETED",
    "HISTORY_SUGGESTIONS_CHANGED",
  ],
  request: {
    params: derivationParams,
    body: z.strictObject({
      suggestions: acceptItemsSchema,
      /** «Застосувати до N наявних транзакцій, що підходять» (off by default). */
      apply: z.boolean().default(false),
    }),
  },
  response: {
    status: 201,
    description:
      "The rules written, the tags created and the run of «Застосувати до наявних» (null without it)",
    schema: z.object({
      rules: z.array(z.object({ id: z.uuid(), position: z.number().int() })),
      tagsCreated: z.number().int(),
      /** Lead decision (row 237): existing transactions matched first by a rule «Переказ» — left as they are. */
      transfers: z.number().int(),
      run: reportSchema.nullable(),
    }),
  },
  handler: async ({ params, body }, ctx) => {
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    await rulesOn(ctx);
    const found = await loaded(ctx, params.derivationId);
    const householdId = ctx.principal.householdId;
    const actorAccountId = ctx.principal.userId;
    const rules = await acceptance(found, householdId, accepting(body.suggestions));
    const plan = body.apply
      ? await acceptancePlan(found.rules, householdId, rules, found.services.scanMax)
      : null;
    let result: AcceptResult;
    try {
      result = await ctx.inHousehold((q) =>
        acceptSuggestions(rulesTx(q), runsTx(q), {
          householdId,
          actorAccountId,
          derivationId: found.run.id,
          rules,
          plan,
          runId: randomUUID(),
          now: found.services.clock.now(),
        }),
      );
    } catch (error) {
      if (!(error instanceof RunRunning)) throw error;
      result = { kind: "running" };
    }
    if (result.kind === "limit") throw new ApiProblem("LIMIT_REACHED", { extensions: { limit: RULES_MAX } });
    if (result.kind === "running") throw new ApiProblem("RULE_RUN_RUNNING");
    if (result.kind === "changed") throw new ApiProblem("HISTORY_SUGGESTIONS_CHANGED");
    for (const entry of result.audit) await rulesAuditNow(found.services.rulesAudit, householdId, entry);
    // FR 17, FR 26: the missing tags created now, each with its entry (module transactions); a failure leaves them to
    // the first transaction a rule tags (it creates them then).
    let tagsCreated = 0;
    const names = [...new Set(result.rules.flatMap((r) => r.tags))];
    if (names.length > 0 && found.rules.tags?.createTags)
      try {
        tagsCreated = await found.rules.tags.createTags(householdId, names, actorAccountId);
      } catch (error) {
        logEvent("categorization.history_tags_deferred", "warn", {
          "ws.module": "categorization",
          "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
        });
      }
    let run = null;
    if (result.run) {
      await foreground(ctx, result.run.id);
      run = await report(ctx, result.run.id);
    }
    return {
      rules: result.rules.map((r) => ({ id: r.id, position: r.position })),
      tagsCreated,
      transfers: plan?.transfers ?? 0,
      run,
    };
  },
});

export const rejectHistorySuggestionRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/category-rule-derivations/{derivationId}/suggestions/{ordinal}/reject",
  operationId: "rejectHistorySuggestion",
  summary:
    "«Відхилити»: the suggestion with these conditions and category is never shown again, also after the next file (BUD-21 FR 23)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 1024,
  problems: ["HISTORY_DERIVATION_NOT_COMPLETED"],
  request: {
    params: z.object({ derivationId: z.uuid(), ordinal: z.coerce.number().int().min(1) }),
    body: z.strictObject({}),
  },
  response: {
    status: 200,
    description: "Rejected; `rejected` false — it was rejected already",
    schema: z.object({ rejected: z.boolean() }),
  },
  handler: async ({ params }, ctx) => {
    if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
    const found = await loaded(ctx, params.derivationId);
    if (found.run.status !== "completed") throw new ApiProblem("HISTORY_DERIVATION_NOT_COMPLETED");
    const suggestion = found.shown.find((s) => s.ordinal === params.ordinal);
    if (!suggestion) throw new ApiProblem("NOT_FOUND");
    const householdId = ctx.principal.householdId;
    const entry = await ctx.inHousehold((q) =>
      rejectSuggestion(derivationsTx(q), {
        householdId,
        actorAccountId: ctx.principal.userId,
        derivation: found.run,
        suggestion,
        now: found.services.clock.now(),
      }),
    );
    await rulesAuditNow(found.services.rulesAudit, householdId, entry);
    return { rejected: entry !== null };
  },
});

export const derivationsRoutes = [
  startHistoryDerivationRoute,
  listHistoryDerivationsRoute,
  getHistoryDerivationRoute,
  matchHistorySuggestionsRoute,
  acceptHistorySuggestionsRoute,
  rejectHistorySuggestionRoute,
];
