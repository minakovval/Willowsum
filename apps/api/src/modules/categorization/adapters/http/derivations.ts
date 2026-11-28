import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import {
  DerivationSourceMissing,
  executeDerivation,
  startDerivation,
  withTransferCategory,
  type DerivationDeps,
  type DerivationRun,
  type DerivationsRun,
  type HistorySourceRow,
  type RulesAuditLog,
  type StoredSuggestion,
} from "../../application/index.ts";
import { DERIVATION_FOREGROUND_MAX } from "../../domain/index.ts";
import { derivationsTx } from "../db/derivations.ts";
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

function presentSuggestion(
  s: StoredSuggestion,
  rows: ReadonlyMap<number, HistorySourceRow & { readonly categoryId: string }>,
  transferId: string | null,
): z.input<typeof suggestionSchema> {
  return {
    ordinal: s.ordinal,
    kind: s.kind,
    action: transferId !== null && s.categoryId === transferId ? "transfer" : "category",
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

export const getHistoryDerivationRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/category-rule-derivations/{derivationId}",
  operationId: "getHistoryDerivation",
  summary:
    "A derivation: «оброблено X з N рядків» and, once completed, its suggestions with evidence and exceptions in the file (BUD-21 FR 10–15, FR 17)",
  access: { permission: "household.data.read", feature: FEATURE },
  request: { params: z.object({ derivationId: z.uuid() }) },
  response: {
    status: 200,
    description: "The derivation and its suggestions (empty until completed)",
    schema: z.object({ derivation: runSchema, suggestions: z.array(suggestionSchema) }),
  },
  handler: async ({ params }, ctx) => {
    const { deps, inSpace } = derivationServices(ctx);
    const householdId = ctx.principal.householdId;
    const found = await inSpace(householdId, async (tx) => {
      const run = await tx.run(householdId, params.derivationId);
      return run ? { run, suggestions: await tx.suggestions(householdId, run.id) } : null;
    });
    if (!found) throw new ApiProblem("NOT_FOUND");
    if (found.suggestions.length === 0) return { derivation: presentRun(found.run), suggestions: [] };
    // FR 24: the suggestions are the file's — once its batch is gone they are gone too.
    const rows = await deps.source.rows(householdId, found.run.batchId);
    if (rows === null) throw new ApiProblem("NOT_FOUND");
    const transferId = await deps.transferCategory(householdId);
    const byRow = new Map(withTransferCategory(rows, transferId).map((r) => [r.row, r]));
    return {
      derivation: presentRun(found.run),
      suggestions: found.suggestions.map((s) => presentSuggestion(s, byRow, transferId)),
    };
  },
});

export const derivationsRoutes = [startHistoryDerivationRoute, getHistoryDerivationRoute];
