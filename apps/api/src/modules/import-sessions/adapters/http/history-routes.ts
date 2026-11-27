import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import {
  DATE_ORDERS,
  HISTORY_MISSING,
  HISTORY_ROLES,
  ROLES,
  type HistoryParse,
  type StatementAnalysis,
} from "../../../file-parsers/index.ts";
import {
  confirmHistoryFile,
  deleteBatch,
  HISTORY_FILE_BYTES,
  HistoryAnswerRefused,
  HistoryConfirmed,
  HistoryNotReady,
  historyViewOf,
  maskedAnalysis,
  parseRefusal,
  rereadHistoryFile,
  suggestedTransfers,
  uploadHistoryFile,
  type HistoryView,
  type HistorySpaceTx,
} from "../../application/index.ts";
import {
  accountValues,
  classifyRows,
  HISTORY_SKIPS,
  HISTORY_VIEW_LIMITS,
  labelTree,
  maskNumbers,
} from "../../domain/index.ts";
import { historyTx } from "../db/store.ts";
import { storageRejection } from "../parse-ports.ts";
import { decisionSchema, evidenceSchema, guessesSchema } from "./review-routes.ts";
import { guarded, owner, uploadRefusal } from "./routes.ts";
import { handOffNow, importSessionsServices } from "./services.ts";

/**
 * History files with the user's categorisation (BUD-21@PoC FR 1, FR 3–6, FR 24, FR 26; wave 2 row 233): upload one
 * from «Правила категорій», read how it was recognised (roles with evidence and alternatives, examples, the file's
 * categories, the transfer values, the account values, the summary, what is missing), correct a role or a format (the
 * file is read again), confirm, «Видалити файл». The space is the session's (П-5): another space's batch, or a
 * statement's, is «not found». A scoped member sees nothing (Owner only in PoC). Behind the release flag
 * `categorization.history-rules` under the feature key of the same name; no plan limit — the technical ceilings of
 * import (never 402).
 */
const MODULE = "import-sessions";
const FEATURE = "categorization.history-rules";
const READ = { permission: "household.data.read", feature: FEATURE } as const;
const WRITE = { permission: "household.data.write", feature: FEATURE } as const;
const extensible = { "x-extensible-enum": true } as const;

const params = z.object({ batchId: z.uuid() });

const runHistory =
  (ctx: ProtectedContext): HistorySpaceTx =>
  (work) =>
    ctx.inHousehold((q) => work(historyTx(q)));

function historyServices(ctx: ProtectedContext) {
  const services = importSessionsServices(ctx);
  if (!services.history) throw new ApiProblem("INTERNAL");
  const { householdId } = ctx.principal;
  const { keys, accounts } = services.history;
  return {
    ...services,
    accounts,
    open: (purpose: string, sealed: Uint8Array) => keys.openBytes(householdId, purpose, sealed),
    seal: (purpose: string, plain: Uint8Array) => keys.sealBytes(householdId, purpose, plain),
  };
}

/** The refusals of these routes; the rest as the batches' routes answer them. */
function historyRefusal(error: unknown): unknown {
  if (error instanceof HistoryConfirmed) return new ApiProblem("BATCH_STATE_CONFLICT");
  if (error instanceof HistoryNotReady)
    return new ApiProblem("HISTORY_NOT_READY", {
      errors: error.codes.map((code) => ({ in: "path", path: "batchId", issue: code })),
    });
  if (error instanceof HistoryAnswerRefused)
    return new ApiProblem("HISTORY_ANSWER_INVALID", {
      errors: [{ in: "body", path: `${error.field}[${error.index}]`, issue: "unknown-value" }],
    });
  return error;
}

const historied = <T>(work: () => Promise<T>): Promise<T> =>
  guarded(async () => {
    try {
      return await work();
    } catch (error) {
      throw historyRefusal(error);
    }
  });

const historyBatchSchema = z.object({
  id: z.uuid(),
  /** «в обробці» while the file is read, «розібрано» once read, «не вдалося розібрати» when refused. */
  state: z.enum(["processing", "parsed", "failed"]).meta(extensible),
  version: z.number().int(),
  createdAt: z.string(),
  /** FR 24: 30 days after it the file, its rows and the batch go (the daily cleanup). */
  lastActionAt: z.string(),
  deleteAfter: z.string(),
  fileName: z.string(),
  format: z.enum(["csv", "tsv", "xlsx", "xls"]).meta(extensible),
  sizeBytes: z.number().int(),
  confirmedAt: z.string().nullable(),
});

const DAY = 24 * 60 * 60 * 1000;

function presentHistoryBatch(
  view: Pick<HistoryView, "batch" | "parse">,
  file: {
    readonly fileName: string;
    readonly format: string | null;
    readonly sizeBytes: number | null;
  },
): z.input<typeof historyBatchSchema> {
  const { batch, parse } = view;
  return {
    id: batch.id,
    state: batch.state as "processing",
    version: batch.version,
    createdAt: batch.createdAt.toISOString(),
    lastActionAt: batch.lastActionAt.toISOString(),
    deleteAfter: new Date(batch.lastActionAt.getTime() + 30 * DAY).toISOString(),
    fileName: file.fileName,
    format: (file.format ?? "csv") as "csv",
    sizeBytes: file.sizeBytes ?? 0,
    confirmedAt: parse.confirmedAt?.toISOString() ?? null,
  };
}

const rejectionSchema = z.object({
  code: z.string().meta(extensible),
  ceiling: z.object({ name: z.string(), limit: z.number().int() }).optional(),
  message: z.object({ uk: z.string(), en: z.string() }),
});

const exampleSchema = z.object({
  row: z.number().int(),
  date: z.string().nullable(),
  /** Exact decimal text, signed, in the row's currency. */
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  /** An IBAN or a card number in the texts is masked to its last 4 characters. */
  description: z.string().nullable(),
  counterparty: z.string().nullable(),
  category: z.string().nullable(),
  subcategory: z.string().nullable(),
  transfer: z.boolean(),
  tags: z.string().nullable(),
  account: z.string().nullable(),
});

const recognitionSchema = z.object({
  table: z.object({
    headerRow: z.number().int().nullable(),
    dataRows: z.number().int(),
    evidence: z.array(evidenceSchema),
  }),
  encoding: guessesSchema,
  delimiter: guessesSchema,
  /** FR 4: every column's role — the statement's or the user's own — with alternatives and «чому так». */
  columns: z.array(
    z.object({ column: z.number().int(), header: z.string().nullable(), role: decisionSchema }),
  ),
  dates: decisionSchema.nullable(),
  numbers: decisionSchema.nullable(),
  sign: decisionSchema.nullable(),
  /** FR 5: a few rows as read. */
  examples: z.array(exampleSchema),
  /** FR 5: the file's categories with their rows, each with its subcategories (transfers have none, FR 8). */
  labels: z.object({
    items: z.array(
      z.object({
        category: z.string(),
        count: z.number().int(),
        subcategories: z.array(z.object({ name: z.string(), count: z.number().int() })),
      }),
    ),
    more: z.boolean(),
  }),
  /** FR 5: the values of the transfer column; `transfer` — counted as a transfer now, `suggested` — by the engine. */
  transfers: z.object({
    values: z.array(
      z.object({ value: z.string(), count: z.number().int(), suggested: z.boolean(), transfer: z.boolean() }),
    ),
    more: z.boolean(),
  }),
  /** FR 5: the values of the account column; `accountId` — the space's account the user chose, null — not matched. */
  accounts: z.object({
    values: z.array(z.object({ value: z.string(), count: z.number().int(), accountId: z.uuid().nullable() })),
    more: z.boolean(),
  }),
  /** FR 5, EC6: rows read, transfers, rows skipped and why. */
  summary: z.object({
    rows: z.number().int(),
    read: z.number().int(),
    transfers: z.number().int(),
    skipped: z.array(z.object({ reason: z.enum(HISTORY_SKIPS).meta(extensible), count: z.number().int() })),
  }),
  /** FR 4, AC3, AC4: what the file lacks for rules; not empty — rules cannot be derived. */
  missing: z.array(z.enum(HISTORY_MISSING).meta(extensible)),
});

const historyViewSchema = z.object({
  batch: historyBatchSchema,
  /** The read the review shows: «Підтвердити» names it, so a read since is refused (409). */
  parseId: z.uuid(),
  parse: z.object({
    state: z.enum(["pending", "parsed", "failed"]).meta(extensible),
    refusal: rejectionSchema.nullable(),
    engineVersion: z.string(),
  }),
  /** FR 6: confirmed — nothing more is corrected; null — not yet (EC9: open for 30 days). */
  confirmed: z.object({ at: z.string() }).nullable(),
  /** FR 5; null while the file is read or when it was refused. */
  recognition: recognitionSchema.nullable(),
  /** «Підтвердити» is allowed: read, nothing missing, a row read, not confirmed yet. */
  canConfirm: z.boolean(),
});

const guesses = <G>(
  g: {
    readonly chosen: G & { readonly score: number };
    readonly alternatives: readonly (G & { readonly score: number })[];
  },
  value: (x: G) => string,
  reason?: string,
) => ({
  chosen: { value: value(g.chosen), score: g.chosen.score, ...(reason ? { reason } : {}) },
  alternatives: g.alternatives.map((a) => ({ value: value(a), score: a.score })),
});

function presentRecognition(
  parsed: HistoryParse,
  transfers: ReadonlySet<string>,
  accounts: ReadonlyMap<string, string | null>,
): z.input<typeof recognitionSchema> {
  const { read, summary } = classifyRows(parsed.rows, transfers);
  const labels = labelTree(read);
  const values = accountValues(read);
  const suggested = new Set(suggestedTransfers(parsed));
  // Plain data of the analysis (readonly arrays), checked against the schema on the way out.
  // IMP-05 «Бізнес-правила»: an IBAN or a card number in a cell shown as an example keeps its last 4 characters, as in
  // a statement's review (`maskedAnalysis`) and in `examples` below.
  const masked = maskedAnalysis({
    table: parsed.table,
    columns: parsed.columns as unknown as StatementAnalysis["columns"],
    dates: parsed.dates,
    numbers: parsed.numbers,
    sign: parsed.sign,
    currency: parsed.currency,
  });
  const plain = structuredClone({
    table: masked.table,
    columns: masked.columns,
    dates: masked.dates,
    numbers: masked.numbers,
    sign: masked.sign,
  }) as unknown as Pick<
    z.input<typeof recognitionSchema>,
    "table" | "columns" | "dates" | "numbers" | "sign"
  >;
  return {
    ...plain,
    encoding: guesses(parsed.reading.encoding, (g) => g.encoding, parsed.reading.encoding.chosen.reason),
    delimiter: guesses(parsed.reading.delimiter, (g) => g.delimiter, parsed.reading.delimiter.chosen.reason),
    examples: parsed.rows.slice(0, HISTORY_VIEW_LIMITS.examples).map((r) => ({
      row: r.row,
      date: r.date,
      amount: r.amount,
      currency: r.currency,
      description: maskNumbers(r.description),
      counterparty: maskNumbers(r.counterparty),
      category: r.category,
      subcategory: r.subcategory,
      transfer: r.transferMark !== null && transfers.has(r.transferMark),
      tags: r.tags,
      account: r.account,
    })),
    labels: {
      items: labels.labels.map((l) => ({ ...l, subcategories: l.subcategories.map((x) => ({ ...x })) })),
      more: labels.more,
    },
    transfers: {
      values: parsed.transfers.values.map((v) => ({
        value: v.value,
        count: v.count,
        suggested: suggested.has(v.value),
        transfer: transfers.has(v.value),
      })),
      more: parsed.transfers.more,
    },
    accounts: {
      values: values.values.map((v) => ({ ...v, accountId: accounts.get(v.value) ?? null })),
      more: values.more,
    },
    summary: { ...summary, skipped: summary.skipped.map((s) => ({ ...s })) },
    missing: [...parsed.missing],
  };
}

async function presentView(
  ctx: ProtectedContext,
  view: HistoryView,
): Promise<z.input<typeof historyViewSchema>> {
  const files = await runHistory(ctx)((tx) => tx.files(view.batch.id));
  const file = files.find((f) => f.id === view.parse.batchFileId) ?? files[0]!;
  const { parse, parsed, answers } = view;
  const transfers = new Set(answers ? answers.transferValues : parsed ? suggestedTransfers(parsed) : []);
  const accounts = new Map((answers?.accounts ?? []).map((a) => [a.value, a.accountId]));
  const recognition = parsed ? presentRecognition(parsed, transfers, accounts) : null;
  return {
    batch: presentHistoryBatch(view, file),
    parseId: parse.parseId,
    parse: {
      state: parse.state,
      refusal:
        parse.state === "failed" && parse.refusalCode
          ? (({ code, ceiling, message }) => ({
              code,
              ...(ceiling ? { ceiling: { ...ceiling } } : {}),
              message: { ...message },
            }))(parseRefusal(parse.refusalCode, storageRejection))
          : null,
      engineVersion: parse.engineVersion,
    },
    confirmed: parse.confirmedAt ? { at: parse.confirmedAt.toISOString() } : null,
    recognition,
    canConfirm:
      !parse.confirmedAt &&
      view.batch.state === "parsed" &&
      recognition !== null &&
      recognition.missing.length === 0 &&
      recognition.summary.read > 0,
  };
}

export const uploadHistoryFileRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/import/history-files",
  operationId: "uploadHistoryFile",
  summary:
    "Uploads a history file with the user's categorisation (BUD-21 FR 3, AC5): checked and stored as a statement is (kind «файл історії»), never applied; the same file still stored opens its batch (`existing`)",
  access: WRITE,
  rateLimit: "upload",
  upload: { maxFiles: 1, maxBytes: HISTORY_FILE_BYTES + 1024 * 1024 },
  problems: ["FILE_REJECTED", "FILE_TOO_LARGE", "PAYLOAD_TOO_LARGE"],
  response: {
    status: 201,
    description: "The history file's batch, its read queued; or the batch of the same file already stored",
    schema: z.object({ batch: historyBatchSchema, parseId: z.uuid(), existing: z.boolean() }),
  },
  handler: async ({ upload }, ctx) => {
    owner(ctx);
    const { deps, originals, audit, open } = historyServices(ctx);
    const { householdId, userId } = ctx.principal;
    if (!upload) throw new ApiProblem("INTERNAL");
    const run = runHistory(ctx);
    const handed = await uploadRefusal(() =>
      uploadHistoryFile(deps, run, originals, { actorId: userId, householdId }, upload),
    );
    await handOffNow(audit, householdId, handed.handOffs);
    const view = await historied(() => run((tx) => historyViewOf(tx, open, handed.result.batch.id)));
    const shown = await presentView(ctx, view);
    return { batch: shown.batch, parseId: shown.parseId, existing: handed.result.existing };
  },
});

export const getHistoryFileRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/history-files/{batchId}",
  operationId: "getHistoryFile",
  summary:
    "The step «Перевірка розпізнавання» (BUD-21 FR 4, FR 5): the roles of the columns with evidence and alternatives, rows as read, the file's categories, the transfer and account values, the summary and what is missing",
  access: READ,
  request: { params },
  response: { status: 200, description: "The history file and how it was read", schema: historyViewSchema },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    const { open } = historyServices(ctx);
    const view = await historied(() => runHistory(ctx)((tx) => historyViewOf(tx, open, params.batchId)));
    return presentView(ctx, view);
  },
});

const columnRole = z.enum([...ROLES, ...HISTORY_ROLES]);

export const rereadHistoryFileRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/import/history-files/{batchId}/reading",
  operationId: "rereadHistoryFile",
  summary:
    "Corrects the reading (BUD-21 FR 6, AC9): a column's role, the date order, the decimal separator or the sign; the file is read again from its original in the background",
  access: WRITE,
  bodyLimitBytes: 16 * 1024,
  request: {
    params,
    body: z
      .object({
        columns: z
          .array(z.object({ column: z.number().int().min(1).max(512), role: columnRole }).strict())
          .max(64)
          .optional(),
        dateOrder: z.enum(DATE_ORDERS).optional(),
        decimalSeparator: z.enum([".", ","]).optional(),
        sign: z.enum(["as-printed", "invert"]).optional(),
      })
      .strict(),
  },
  problems: ["BATCH_STATE_CONFLICT"],
  response: { status: 200, description: "The history file, read again", schema: historyViewSchema },
  handler: async ({ params, body }, ctx) => {
    owner(ctx);
    const { deps, audit, open } = historyServices(ctx);
    const { householdId, userId } = ctx.principal;
    const run = runHistory(ctx);
    const { handOffs } = await historied(() =>
      run((tx) =>
        rereadHistoryFile(deps, tx, userId, params.batchId, {
          ...(body.columns ? { columns: body.columns } : {}),
          ...(body.dateOrder ? { dateOrder: body.dateOrder } : {}),
          ...(body.decimalSeparator ? { decimalSeparator: body.decimalSeparator } : {}),
          ...(body.sign ? { sign: body.sign } : {}),
        }),
      ),
    );
    await handOffNow(audit, householdId, handOffs);
    return presentView(ctx, await run((tx) => historyViewOf(tx, open, params.batchId)));
  },
});

export const confirmHistoryFileRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/import/history-files/{batchId}/confirm",
  operationId: "confirmHistoryFile",
  summary:
    "«Підтвердити» the reading (BUD-21 FR 6): the read shown (`parseId`), the values that mark a transfer (default — the engine's suggestion) and the account of each value; nothing is created without it",
  access: WRITE,
  bodyLimitBytes: 64 * 1024,
  request: {
    params,
    body: z
      .object({
        parseId: z.uuid(),
        transferValues: z.array(z.string().max(200)).max(50).optional(),
        accounts: z
          .array(z.object({ value: z.string().max(200), accountId: z.uuid().nullable() }).strict())
          .max(100)
          .optional(),
      })
      .strict(),
  },
  problems: ["BATCH_STATE_CONFLICT", "HISTORY_NOT_READY", "HISTORY_ANSWER_INVALID"],
  response: { status: 200, description: "The confirmed history file", schema: historyViewSchema },
  handler: async ({ params, body }, ctx) => {
    owner(ctx);
    const { deps, audit, open, seal, accounts } = historyServices(ctx);
    const { householdId, userId } = ctx.principal;
    // An account of another space, or a closed one, is the same answer as a value the file does not have.
    for (const [i, a] of (body.accounts ?? []).entries())
      if (
        a.accountId !== null &&
        (await accounts.postingAccount(householdId, a.accountId))?.status !== "active"
      )
        throw new ApiProblem("HISTORY_ANSWER_INVALID", {
          errors: [{ in: "body", path: `accounts[${i}].accountId`, issue: "unknown-account" }],
        });
    const { result, handOffs } = await historied(() =>
      runHistory(ctx)((tx) =>
        confirmHistoryFile(deps, tx, { open, seal }, userId, params.batchId, {
          parseId: body.parseId,
          ...(body.transferValues ? { transferValues: body.transferValues } : {}),
          ...(body.accounts ? { accounts: body.accounts } : {}),
        }),
      ),
    );
    await handOffNow(audit, householdId, handOffs);
    return presentView(ctx, result);
  },
});

export const deleteHistoryFileRoute = defineRoute({
  module: MODULE,
  method: "DELETE",
  path: "/v1/import/history-files/{batchId}",
  operationId: "deleteHistoryFile",
  summary:
    "«Видалити файл» (BUD-21 FR 24): the original and the rows as read go now, not after 30 days; what was confirmed stays",
  access: WRITE,
  request: { params },
  response: { status: 200, description: "Deleted", schema: z.object({ deleted: z.literal(true) }) },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    const { deps, originals, audit } = historyServices(ctx);
    const { householdId, userId } = ctx.principal;
    const { handOffs } = await historied(() =>
      deleteBatch(deps, runHistory(ctx), originals, householdId, userId, params.batchId),
    );
    await handOffNow(audit, householdId, handOffs);
    return { deleted: true as const };
  },
});

export const historyFileRoutes = [
  uploadHistoryFileRoute,
  getHistoryFileRoute,
  rereadHistoryFileRoute,
  confirmHistoryFileRoute,
  deleteHistoryFileRoute,
];
