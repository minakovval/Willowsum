import { z } from "zod";
import { decodeCursor, encodeCursor, pageOf, pageQuery } from "../../../../platform/http/pagination.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, DOWNLOAD_RESPONSE, type ProtectedContext } from "../../../../platform/http/route.ts";
import { bankName, FLAG_SEVERITY, type BatchFlagCode } from "../../../file-parsers/index.ts";
import { PlanTooLargeError, planImport } from "../../../duplicate-matching/index.ts";
import { FileNotFoundError } from "../../../file-storage/index.ts";
import {
  ImportBusy,
  ImportRollbackBusy,
  ImportWriteRefused,
  ROLLBACK_MODES,
} from "../../../transactions/index.ts";
import {
  addFiles,
  applyBatch,
  batchResult,
  followUpOf,
  hasFollowUp,
  ApplyNotReady,
  ApplyRowsRefused,
  ApplyTooLarge,
  ApplyUnsupported,
  BALANCE_CHOICES,
  decide,
  DecisionRefused,
  DECISIONS_PER_REQUEST,
  decisionsOf,
  DATE_ORDER_CHOICES,
  GROUP_ACTIONS,
  GROUPS,
  READINESS_CODES,
  READINESS_MESSAGES,
  readinessOf,
  ROW_ACTIONS,
  type Decided,
  type DecisionInput,
  type Refusal,
  BatchNotFoundError,
  BatchStateErrorFor,
  cancelBatch,
  createBatch,
  deleteBatch,
  originalOf,
  viewBatch,
  type Batch,
  type BatchFile,
  type FileOutcome,
  type FileRejection,
  type SpaceTx,
  ParseRateLimited,
  ParseRequestRefused,
  parseRefusal,
  parseViewOf,
  requestParse,
  rowsOf,
  RollbackExpired,
  rollbackBatch,
  rollbackUntil,
  type FileParse,
  type FileReview,
  type ParseRequest,
} from "../../application/index.ts";
import { ACCOUNT_MATCHES, BATCH_LIMITS, BATCH_STATES, BatchStateError } from "../../domain/index.ts";
import { applyTx, batchesTx } from "../db/store.ts";
import { maskNumbers } from "../../domain/index.ts";

export { maskNumbers };
import { storageRejection } from "../parse-ports.ts";
import { handOffNow, importSessionsServices } from "./services.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";

/**
 * Import batches (IMP-01@PoC FR 1, FR 3, FR 6, FR 7, FR 10, FR 12, FR 13, FR 21; IMP-19@PoC FR 5; wave 2 row 39): create
 * a batch, upload files to it (multipart, read on the stream under one budget, each stored by file-storage), list and
 * read batches, cancel or delete one, open an original through a signed link of ≤ 15 minutes. The space is the session's
 * (П-5): a batch, a file or a link of another space is «not found». A scoped member sees no batch (00-general «Область
 * доступу»: imports are the Owner's; PoC has one user). Behind the release flag `data.import` under the feature key of the
 * same name; no plan limit or quota — only the technical ceilings, the same for every plan (FR 13, FR 18; never 402).
 */
const MODULE = "import-sessions";
const FEATURE = "data.import";
const READ = { permission: "household.data.read", feature: FEATURE } as const;
const WRITE = { permission: "household.data.write", feature: FEATURE } as const;

const batchParams = z.object({ batchId: z.uuid() });

const ceilingSchema = z.object({ name: z.string(), limit: z.number().int() });
const rejectionSchema = z.object({
  code: z.string().meta({ "x-extensible-enum": true }),
  ceiling: ceilingSchema.optional(),
  message: z.object({ uk: z.string(), en: z.string() }),
});

const fileSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  fileName: z.string(),
  status: z.enum(["accepted", "rejected"]),
  format: z.enum(["csv", "tsv", "xlsx", "xls"]).nullable(),
  sizeBytes: z.number().int().nullable(),
  rejectionCode: z.string().nullable(),
  createdAt: z.string(),
});

const batchSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  state: z.enum(BATCH_STATES),
  version: z.number().int(),
  createdAt: z.string(),
  lastActionAt: z.string(),
  /** #654: «застосовано» with its apply still in progress (the rows being written; settled by a retry or the daily recovery). */
  applying: z.boolean(),
  /**
   * IMP-16 FR 1, AC4: «застосовано» — the last moment «Відкотити» is offered (7 days after the apply finished); null —
   * not applied, still applying, or rolled back. Past it the client shows no «Відкотити».
   */
  rollbackUntil: z.string().nullable(),
  /** Accepted and rejected files of the batch. */
  files: z.object({ accepted: z.number().int(), rejected: z.number().int() }),
});

const batchDetailSchema = batchSchema.extend({ fileList: z.array(fileSchema) });

function presentFile(f: BatchFile): z.input<typeof fileSchema> {
  return {
    id: f.id,
    position: f.position,
    fileName: f.fileName,
    status: f.fileId ? "accepted" : "rejected",
    format: f.format as z.input<typeof fileSchema>["format"],
    sizeBytes: f.sizeBytes,
    rejectionCode: f.rejectionCode,
    createdAt: f.createdAt.toISOString(),
  };
}

function presentBatch(b: Batch, files: readonly BatchFile[]): z.input<typeof batchSchema> {
  const accepted = files.filter((f) => f.fileId).length;
  return {
    id: b.id,
    name: b.name,
    state: b.state,
    version: b.version,
    createdAt: b.createdAt.toISOString(),
    lastActionAt: b.lastActionAt.toISOString(),
    applying: b.applying ?? false,
    rollbackUntil:
      b.state === "applied" && !b.applying && b.appliedAt ? rollbackUntil(b.appliedAt).toISOString() : null,
    files: { accepted, rejected: files.length - accepted },
  };
}

/** A batch (or file) of another space or unknown: one answer, never a hint that it exists. */
function refusal(error: unknown): unknown {
  if (error instanceof BatchNotFoundError || error instanceof FileNotFoundError)
    return new ApiProblem("NOT_FOUND");
  if (error instanceof BatchStateError || error instanceof BatchStateErrorFor)
    return new ApiProblem("BATCH_STATE_CONFLICT");
  // IMP-05 FR 7, AC7; the index and the issue's code only, never the value sent.
  if (error instanceof DecisionRefused)
    return new ApiProblem(
      error.issue === "READING_TOO_PRECISE" ? "READING_TOO_PRECISE" : "IMPORT_DECISION_INVALID",
      { errors: [{ in: "body", path: `decisions[${error.index}]`, issue: error.issue }] },
    );
  if (error instanceof ParseRequestRefused)
    return new ApiProblem("IMPORT_PARSE_INVALID", {
      errors: [{ in: "body", path: `files[${error.index}].${error.field}`, issue: error.issue }],
    });
  // IMP-01 FR 11: the apply's refusals — codes and row numbers only, never a value of a row.
  if (error instanceof ApplyNotReady)
    return new ApiProblem("IMPORT_NOT_READY", {
      errors: error.codes.map((code) => ({ in: "path", path: "batchId", issue: code })),
    });
  if (error instanceof ApplyRowsRefused)
    return new ApiProblem("IMPORT_ROWS_REFUSED", {
      errors: error.rows.map((r) => ({
        in: "path",
        path: r.row === null ? `files[${r.fileId}]` : `files[${r.fileId}].rows[${r.row}]`,
        issue: r.issue,
      })),
    });
  if (error instanceof ImportWriteRefused) {
    if (error.issue === "account-closed") return new ApiProblem("ACCOUNT_CLOSED");
    // #654: a wallet of the account changed while the rows were planned: nothing written, try again.
    if (error.issue === "account-changed") return new ApiProblem("BATCH_STATE_CONFLICT");
    const issue =
      error.issue === "account-not-found" || error.issue === "file-not-in-batch" ? "account" : error.issue;
    return new ApiProblem("IMPORT_ROWS_REFUSED", {
      errors: [
        {
          in: "path",
          path: error.fileId === null ? "batchId" : `files[${error.fileId}].rows[${error.row ?? 0}]`,
          issue: issue === "amount" ? "too-precise" : issue === "date" ? "unreadable" : issue,
        },
      ],
    });
  }
  if (error instanceof PlanTooLargeError) return new ApiProblem("IMPORT_PLAN_TOO_LARGE");
  // IMP-04 AC8: «Строк відкату минув»; a row of the batch held by another change — try again.
  if (error instanceof RollbackExpired) return new ApiProblem("IMPORT_ROLLBACK_EXPIRED");
  if (error instanceof ImportRollbackBusy) return new ApiProblem("BATCH_STATE_CONFLICT");
  // #654: the ceiling of rows per apply (split the batch), and of applies of the space at once (try again).
  if (error instanceof ApplyTooLarge)
    return new ApiProblem("IMPORT_PLAN_TOO_LARGE", {
      errors: [{ in: "path", path: "batchId", issue: "rows" }],
    });
  if (error instanceof ImportBusy) return new ApiProblem("RATE_LIMITED", { retryAfterS: 60 });
  if (error instanceof ApplyUnsupported)
    return new ApiProblem("IMPORT_APPLY_UNSUPPORTED", {
      errors: [{ in: "path", path: "batchId", issue: error.reason }],
    });
  // #624: the space's parse requests are bounded per hour (a technical ceiling, never 402).
  if (error instanceof ParseRateLimited) return new ApiProblem("RATE_LIMITED", { retryAfterS: 3600 });
  return error;
}

export async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw refusal(error);
  }
}

/** The route's transactions, bound to the session's space (П-5). */
const routeTx =
  (ctx: ProtectedContext): SpaceTx =>
  (work) =>
    ctx.inHousehold((q) => work(batchesTx(q)));

export function owner(ctx: ProtectedContext): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

/**
 * IMP-04@PoC «Права доступу», IMP-16@PoC FR 1: «Відкочує партію лише Owner». `household.data.write` is also held by
 * Admin and Editor, so the role is checked here, before the batch is read: one answer for any batch id, known or not.
 */
function ownerOnly(ctx: ProtectedContext): void {
  if (ctx.principal.scoped || ctx.principal.role !== "owner") throw new ApiProblem("FORBIDDEN");
}

export const createImportBatchRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/import/batches",
  operationId: "createImportBatch",
  summary: "Creates an import batch (FR 1): «завантажено», its name optional; files are uploaded to it next",
  access: WRITE,
  create: true,
  bodyLimitBytes: 4 * 1024,
  request: { body: z.object({ name: z.string().trim().min(1).max(120).nullable().optional() }).strict() },
  response: { status: 201, description: "The new batch", schema: batchSchema },
  handler: async ({ body }, ctx) => {
    owner(ctx);
    const { deps, audit } = importSessionsServices(ctx);
    const { householdId, userId } = ctx.principal;
    const { result, handOffs } = await routeTx(ctx)((tx) =>
      createBatch(deps, tx, userId, householdId, body.name ?? null),
    );
    await handOffNow(audit, householdId, handOffs);
    return presentBatch(result, []);
  },
});

const batchPosition = z.object({ c: z.iso.datetime(), i: z.uuid() });

export const listImportBatchesRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/batches",
  operationId: "listImportBatches",
  summary: "The space's import batches, newest first (the history of imports, FR 9)",
  access: READ,
  list: true,
  request: { query: pageQuery },
  response: { status: 200, description: "A page of batches", schema: pageOf(batchSchema) },
  handler: async ({ query }, ctx) => {
    owner(ctx);
    const after = query.cursor ? decodeCursor(query.cursor, batchPosition) : null;
    const rows = await routeTx(ctx)(async (tx) => {
      const batches = await tx.listBatches(
        query.limit + 1,
        after ? { createdAt: new Date(after.c), id: after.i } : undefined,
      );
      return Promise.all(batches.map(async (b) => ({ b, files: await tx.files(b.id) })));
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(({ b, files }) => presentBatch(b, files)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ c: last.b.createdAt.toISOString(), i: last.b.id })
          : null,
    };
  },
});

export const getImportBatchRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/batches/{batchId}",
  operationId: "getImportBatch",
  summary:
    "An import batch with its files: accepted ones with format and size, rejected ones with the reason",
  access: READ,
  request: { params: batchParams },
  response: { status: 200, description: "The batch", schema: batchDetailSchema },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    importSessionsServices(ctx);
    const { batch, files } = await guarded(() => routeTx(ctx)((tx) => viewBatch(tx, params.batchId)));
    return { ...presentBatch(batch, files), fileList: files.map(presentFile) };
  },
});

const present = (r: FileRejection | null) =>
  r ? { code: r.code, ...(r.ceiling ? { ceiling: { ...r.ceiling } } : {}), message: { ...r.message } } : null;

export const uploadImportFilesRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/import/batches/{batchId}/files",
  operationId: "uploadImportFiles",
  summary:
    "Uploads files to a batch (FR 3, FR 6, FR 7, FR 13): each is checked by content and stored as the original, or rejected on its own; all rejected — the first reason",
  access: WRITE,
  rateLimit: "upload",
  // The platform's stop on the raw stream: the batch's 50 files and 150 MiB, plus the multipart framing.
  upload: { maxFiles: BATCH_LIMITS.files, maxBytes: BATCH_LIMITS.bytes + 1024 * 1024 },
  request: { params: batchParams },
  problems: ["FILE_REJECTED", "FILE_TOO_LARGE", "BATCH_STATE_CONFLICT", "PAYLOAD_TOO_LARGE"],
  response: {
    status: 201,
    description: "The batch and what became of each file of this upload",
    schema: z.object({
      batch: batchSchema,
      files: z.array(fileSchema.extend({ rejection: rejectionSchema.nullable() })),
      /** Files the batch had no place for (BATCH_TOO_MANY_FILES, #582 item 7): no row, so no id, position or time. */
      refused: z.array(z.object({ fileName: z.string(), rejection: rejectionSchema })),
    }),
  },
  handler: async ({ params, upload }, ctx) => {
    owner(ctx);
    const { deps, originals, audit } = importSessionsServices(ctx);
    const { householdId, userId } = ctx.principal;
    if (!upload) throw new ApiProblem("INTERNAL");
    const run = routeTx(ctx);
    let handed;
    try {
      handed = await addFiles(deps, run, originals, { actorId: userId, householdId }, params.batchId, upload);
    } catch (error) {
      throw refusal(error);
    }
    await handOffNow(audit, householdId, handed.handOffs);
    const { batch, files, firstRejection } = handed.result;
    // FR 6: every file of this upload was rejected — the first one's reason, with its code (413 for a size, else 422).
    if (firstRejection)
      throw new ApiProblem(firstRejection.status === 413 ? "FILE_TOO_LARGE" : "FILE_REJECTED", {
        detail: firstRejection.message.en,
        extensions: {
          rejection: {
            code: firstRejection.code,
            ...(firstRejection.ceiling ? { ceiling: firstRejection.ceiling } : {}),
          },
        },
      });
    const all = await run((tx) => tx.files(batch.id));
    return {
      batch: presentBatch(batch, all),
      files: files.flatMap((o: FileOutcome) =>
        o.file ? [{ ...presentFile(o.file), rejection: present(o.rejection) }] : [],
      ),
      refused: files.flatMap((o: FileOutcome) =>
        !o.file && o.rejection ? [{ fileName: o.fileName, rejection: present(o.rejection)! }] : [],
      ),
    };
  },
});

export const cancelImportBatchRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/import/batches/{batchId}/cancel",
  operationId: "cancelImportBatch",
  summary:
    "«Скасувати» (FR 12): the batch closes without writing anything; from any state before «застосовано»",
  access: WRITE,
  request: { params: batchParams },
  problems: ["BATCH_STATE_CONFLICT"],
  response: { status: 200, description: "The cancelled batch", schema: batchSchema },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    const { deps, audit } = importSessionsServices(ctx);
    const { householdId, userId } = ctx.principal;
    const run = routeTx(ctx);
    const { result, handOffs } = await guarded(() =>
      run((tx) => cancelBatch(deps, tx, userId, params.batchId)),
    );
    await handOffNow(audit, householdId, handOffs);
    return presentBatch(result, await run((tx) => tx.files(result.id)));
  },
});

export const deleteImportBatchRoute = defineRoute({
  module: MODULE,
  method: "DELETE",
  path: "/v1/import/batches/{batchId}",
  operationId: "deleteImportBatch",
  summary:
    "«Видалити» (FR 12, EC4): a batch with its originals; an applied one is rolled back first (409), then it may be deleted",
  access: WRITE,
  request: { params: batchParams },
  problems: ["BATCH_STATE_CONFLICT"],
  response: { status: 200, description: "Deleted", schema: z.object({ deleted: z.literal(true) }) },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    const { deps, originals, audit } = importSessionsServices(ctx);
    const { householdId, userId } = ctx.principal;
    const { handOffs } = await guarded(() =>
      deleteBatch(deps, routeTx(ctx), originals, householdId, userId, params.batchId),
    );
    await handOffNow(audit, householdId, handOffs);
    return { deleted: true as const };
  },
});

const fileParams = z.object({ batchId: z.uuid(), fileId: z.uuid() });

export const linkImportOriginalRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/import/batches/{batchId}/files/{fileId}/link",
  operationId: "linkImportOriginal",
  summary:
    "A short signed link to an accepted file's original (FR 7): valid for at most 15 minutes, this space only",
  access: READ,
  request: { params: fileParams },
  response: {
    status: 200,
    description: "The link's token and when it expires",
    schema: z.object({ token: z.string(), expiresAt: z.string() }),
  },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    const { originals } = importSessionsServices(ctx);
    const { householdId } = ctx.principal;
    const link = await guarded(async () => {
      const fileId = await routeTx(ctx)((tx) => originalOf(tx, params.batchId, params.fileId));
      return originals.link(householdId, fileId);
    });
    return { token: link.token, expiresAt: link.expiresAt.toISOString() };
  },
});

export const openImportOriginalRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/originals/{token}",
  operationId: "openImportOriginal",
  summary:
    "Opens a signed link (FR 7): the original bytes, only as a download with `nosniff`; another space's — not found",
  access: READ,
  download: true,
  request: {
    params: z.object({
      token: z
        .string()
        .min(1)
        .max(256)
        .regex(/^[A-Za-z0-9._-]+$/),
    }),
  },
  response: { status: 200, description: "The original file, as a download", schema: DOWNLOAD_RESPONSE },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    const { originals } = importSessionsServices(ctx);
    return guarded(() => originals.open(ctx.principal.householdId, params.token));
  },
});

// ——— IMP-05@PoC part 2: decisions and the readiness to apply (FR 2, FR 4, FR 7, FR 10, FR 11) ———

const FLAG_CODES = Object.keys(FLAG_SEVERITY) as [BatchFlagCode, ...BatchFlagCode[]];
const row = z.number().int().min(1).max(1_000_000);
const fileId = z.uuid();
const decisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("row"), fileId, row, action: z.enum(ROW_ACTIONS) }),
  z.strictObject({
    kind: z.literal("reading"),
    fileId,
    row,
    value: z.string().regex(/^-?\d{1,80}(\.\d{1,30})?$/),
    applyToFile: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("date-order"), fileId, order: z.enum(DATE_ORDER_CHOICES) }),
  z.strictObject({
    kind: z.literal("group"),
    fileId: fileId.nullable(),
    group: z.enum(GROUPS),
    action: z.enum(GROUP_ACTIONS),
  }),
  z.strictObject({ kind: z.literal("flag"), fileId: fileId.nullable(), code: z.enum(FLAG_CODES) }),
  z.strictObject({ kind: z.literal("account"), fileId }),
  z.strictObject({ kind: z.literal("balance"), fileId, choice: z.enum(BALANCE_CHOICES) }),
]);
const decidedSchema = z.object({
  decision: decisionSchema,
  decidedAt: z.string(),
});

/** A stored decision as sent (the reading's separator is the server's own). */
function presentDecided(d: Decided): z.input<typeof decidedSchema> {
  const { decision } = d;
  const sent =
    decision.kind === "reading"
      ? {
          kind: decision.kind,
          fileId: decision.fileId,
          row: decision.row,
          value: decision.value,
          applyToFile: decision.applyToFile,
        }
      : decision;
  return { decision: sent, decidedAt: d.decidedAt.toISOString() };
}

const decisionsResponse = z.object({
  version: z.number().int(),
  decisions: z.array(decidedSchema),
  /** GET: the cursor of the next page; null on the last page (and always on POST). */
  nextCursor: z.string().nullable(),
});
const decisionCursor = z.object({ s: z.string().min(3).max(120) });

export const decideImportBatchRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/import/batches/{batchId}/decisions",
  operationId: "decideImportBatch",
  summary:
    "Decisions on a parsed batch (IMP-05 FR 10): rows, groups, readings, flags, the account and the balance choice; all or none; each replaces the one before until the batch is applied",
  access: WRITE,
  bodyLimitBytes: 64 * 1024,
  request: {
    params: batchParams,
    body: z.strictObject({ decisions: z.array(decisionSchema).min(1).max(DECISIONS_PER_REQUEST) }),
  },
  problems: ["BATCH_STATE_CONFLICT", "READING_TOO_PRECISE", "IMPORT_DECISION_INVALID"],
  response: {
    status: 200,
    description: "This request's decisions as stored (at most 200)",
    schema: decisionsResponse,
  },
  handler: async ({ params, body }, ctx) => {
    owner(ctx);
    const { deps, audit } = importSessionsServices(ctx);
    const { householdId, userId } = ctx.principal;
    const { result, handOffs, version } = await guarded(() =>
      ctx.inHousehold(async (q) => {
        const tx = batchesTx(q);
        const handed = await decide(deps, tx, userId, params.batchId, body.decisions as DecisionInput[]);
        return { ...handed, version: (await tx.findBatch(params.batchId))!.version };
      }),
    );
    await handOffNow(audit, householdId, handOffs);
    return { version, decisions: result.map(presentDecided), nextCursor: null };
  },
});

export const listImportDecisionsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/batches/{batchId}/decisions",
  operationId: "listImportDecisions",
  summary: "The batch's decisions (IMP-05 FR 10), a page at a time by slot",
  access: READ,
  // Paged with pageQuery (≤ 100 a page); the answer keeps `decisions` and the batch's `version` beside the cursor.
  request: { params: batchParams, query: pageQuery },
  response: { status: 200, description: "A page of the batch's decisions", schema: decisionsResponse },
  handler: async ({ params, query }, ctx) => {
    owner(ctx);
    importSessionsServices(ctx);
    const after = query.cursor ? decodeCursor(query.cursor, decisionCursor).s : undefined;
    return guarded(() =>
      ctx.inHousehold(async (q) => {
        const tx = batchesTx(q);
        const rows = await decisionsOf(tx, params.batchId, {
          limit: query.limit + 1,
          ...(after !== undefined ? { after } : {}),
        });
        const page = rows.slice(0, query.limit);
        return {
          version: (await tx.findBatch(params.batchId))!.version,
          decisions: page.map(presentDecided),
          nextCursor: rows.length > query.limit ? encodeCursor({ s: page.at(-1)!.slot }) : null,
        };
      }),
    );
  },
});

const rowsLeft = { fileId: z.uuid(), rows: z.array(z.number().int()), count: z.number().int() };
const message = z.object({ uk: z.string(), en: z.string() });
const flagSchema = z.object({
  code: z.enum(FLAG_CODES),
  severity: z.enum(["block", "review"]),
  difference: z.string().optional(),
  check: z.string().optional(),
  count: z.number().int().optional(),
  positive: z.number().int().optional(),
  negative: z.number().int().optional(),
  /** `checksum-mismatch` (FR 2, AC1): «Застосувати й оновити залишок до виписки» or «… без оновлення залишку». */
  choices: z.array(z.enum(BALANCE_CHOICES)).optional(),
});
const refusalSchema = z.discriminatedUnion("code", [
  z.object({
    code: z.literal("confirm-account"),
    message,
    files: z.array(
      z.object({
        fileId: z.uuid(),
        /** The file has no account yet: one is chosen for it first. */
        missing: z.boolean(),
        /** Masked to the last 4 characters. */
        reasons: z.array(
          z.object({ kind: z.enum(["iban", "card", "currency"]), file: z.string(), account: z.string() }),
        ),
        suggestedAccountId: z.uuid().nullable(),
      }),
    ),
  }),
  z.object({
    code: z.literal("clarifications"),
    message,
    files: z.array(z.object({ ...rowsLeft, dateOrder: z.boolean() })),
  }),
  z.object({ code: z.literal("review-rows"), message, files: z.array(z.object(rowsLeft)) }),
  z.object({
    code: z.literal("flags"),
    message,
    files: z.array(z.object({ fileId: z.uuid(), flags: z.array(flagSchema) })),
  }),
]);

const presentRefusal = (r: Refusal) =>
  ({ ...r, message: { ...READINESS_MESSAGES[r.code] } }) as z.input<typeof refusalSchema>;

export const importBatchReadinessRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/batches/{batchId}/readiness",
  operationId: "getImportBatchReadiness",
  summary:
    "Whether the batch may be applied (IMP-05 FR 11): each refusal with its explanation — «Підтвердіть рахунок», «Потрібні уточнення», «Потрібен перегляд рядків», «Не підтверджені позначки»; ready with no decision when everything agrees",
  access: READ,
  request: { params: batchParams },
  problems: ["BATCH_STATE_CONFLICT"],
  response: {
    status: 200,
    description: "The readiness and the balance choice of each file",
    schema: z.object({
      ready: z.boolean(),
      refusals: z.array(refusalSchema),
      codes: z.array(z.enum(READINESS_CODES)),
      files: z.array(
        z.object({
          fileId: z.uuid(),
          /** FR 2: null — the figures agree, no choice was needed. */
          balance: z.enum(BALANCE_CHOICES).nullable(),
          history: z.object({
            status: z.enum(["continuous", "gap", "overlap", "unknown"]),
            range: z.object({ from: z.string(), to: z.string() }).nullable(),
            previousClosing: z.string().nullable(),
            newOpening: z.string().nullable(),
            difference: z.string().nullable(),
            currency: z.string().nullable(),
          }),
        }),
      ),
    }),
  },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    importSessionsServices(ctx);
    const r = await guarded(() => ctx.inHousehold((q) => readinessOf(batchesTx(q), params.batchId)));
    const history = new Map(r.reviews.map((v) => [v.batchFileId, v.history]));
    return {
      ready: r.ready,
      refusals: r.refusals.map(presentRefusal),
      codes: r.refusals.map((x) => x.code),
      files: r.files.map((f) => ({
        fileId: f.fileId,
        balance: f.balance,
        history: { ...history.get(f.fileId)! },
      })),
    };
  },
});

// ——— The parse step (IMP-01@PoC FR 5, FR 6, FR 10, FR 15; IMP-19@PoC FR 4, FR 5; IMP-05@PoC FR 3) ———

const parseRequestSchema = z.strictObject({
  fileId: z.uuid(),
  /** The recipe to parse the file with; omitted — the space's recipe made for the file's format, if any (IMP-06 FR 7). */
  recipeId: z.uuid().nullable().optional(),
  /** The account the file is for (FR 1); omitted — chosen later («Підтвердіть рахунок»). */
  accountId: z.uuid().nullable().optional(),
});

export const parseImportBatchRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/import/batches/{batchId}/parse",
  operationId: "parseImportBatch",
  summary:
    "«Розібрати» (FR 5, FR 21): every accepted file is parsed in the background with its chosen or matched recipe and its account; the batch is «в обробці» until the last file is done",
  access: WRITE,
  // #624: each parse answers whether the file holds the recipe's sealed account value — bounded per space and hour
  // (PARSE_FILES_PER_HOUR, in requestParse) on top of the per-address limit of every route.
  bodyLimitBytes: 16 * 1024,
  request: {
    params: batchParams,
    body: z.strictObject({ files: z.array(parseRequestSchema).max(BATCH_LIMITS.files).optional() }),
  },
  problems: ["BATCH_STATE_CONFLICT", "IMPORT_PARSE_INVALID"],
  response: { status: 200, description: "The batch, «в обробці»", schema: batchSchema },
  handler: async ({ params, body }, ctx) => {
    owner(ctx);
    const { deps, audit, parse } = importSessionsServices(ctx);
    if (!parse) throw new ApiProblem("INTERNAL");
    const { householdId, userId } = ctx.principal;
    const requests = (body.files ?? []) as ParseRequest[];
    // Another space's recipe or account is the same answer as an unknown one; a closed account is not offered (FR 2).
    for (const [i, r] of requests.entries()) {
      if (r.recipeId && !(await parse.recipes.forParse(householdId, r.recipeId)))
        throw refusal(new ParseRequestRefused("UNKNOWN_RECIPE", i, "recipeId"));
      if (r.accountId) {
        const account = await parse.accounts.postingAccount(householdId, r.accountId);
        if (account?.status !== "active")
          throw refusal(new ParseRequestRefused("UNKNOWN_ACCOUNT", i, "accountId"));
      }
    }
    const run = routeTx(ctx);
    const { result, handOffs } = await guarded(() =>
      ctx.inHousehold((q) => requestParse(deps, batchesTx(q), userId, params.batchId, requests)),
    );
    await handOffNow(audit, householdId, handOffs);
    return presentBatch(result, await run((tx) => tx.files(result.id)));
  },
});

const parseFileSchema = z.object({
  fileId: z.uuid(),
  position: z.number().int(),
  state: z.enum(["pending", "parsed", "failed"]),
  /** FR 15: why the file could not be parsed; a ceiling's text names it and advises splitting the file. */
  refusal: rejectionSchema.nullable(),
  /** FR 9: the recipe the file was parsed with, and whether its format matched (IMP-06 FR 6). */
  recipe: z.object({ id: z.uuid(), format: z.enum(["match", "changed", "unknown"]) }).nullable(),
  accountId: z.uuid().nullable(),
  engineVersion: z.string(),
  rowCount: z.number().int().nullable(),
  /** IMP-05: the file's checks (masked values only) and its history gap against the previous statement (FR 3). */
  checks: z.looseObject({ currency: z.string().nullable(), flags: z.array(flagSchema) }).nullable(),
  history: z.looseObject({ status: z.enum(["continuous", "gap", "overlap", "unknown"]) }).nullable(),
  previousFileId: z.uuid().nullable(),
  /**
   * IMP-08 FR 2 (rows 230, 230b): what the file says about its own account, for «Створити рахунок» — the bank as the
   * directory names it (GET /v1/accounts/banks), else as the file prints it (`bankInDirectory` false; at most 100
   * characters and 4 digits), the statement's one currency and the card or IBAN as «…» and its last 4 characters. Each
   * part only when the file names it unambiguously; absent until the file is parsed (optional: the clients of the base
   * contract keep compiling). `accountMatch`: how the facts fit the space's accounts when the file was parsed —
   * `picked` (one account; the file's `accountId` unless the person chose another), `several` (the person picks among
   * them), `none` (no account fits: «Створити рахунок»); absent when the file names neither a bank nor a number.
   */
  detected: z
    .object({
      bank: z.string().optional(),
      bankInDirectory: z.boolean().optional(),
      currency: z.string().optional(),
      mask: z.string().optional(),
      accountMatch: z.enum(ACCOUNT_MATCHES).optional(),
    })
    .optional(),
});

/** Only the three facts, each a short text; anything else a stored check holds is dropped (masked values only). */
function presentDetected(
  checks: FileReview["checks"],
): NonNullable<z.input<typeof parseFileSchema>["detected"]> {
  const d = checks.detected ?? {};
  const text = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : undefined);
  const bank = typeof d.bank === "string" ? (bankName(d.bank) ?? undefined) : undefined;
  const currency = text(d.currency, 10);
  const mask = typeof d.mask === "string" && /^…[A-Za-z0-9]{4}$/.test(d.mask) ? d.mask : undefined;
  const match = ACCOUNT_MATCHES.find((m) => m === d.accountMatch);
  return {
    ...(bank !== undefined
      ? { bank, ...(typeof d.bankInDirectory === "boolean" ? { bankInDirectory: d.bankInDirectory } : {}) }
      : {}),
    ...(match !== undefined ? { accountMatch: match } : {}),
    ...(currency !== undefined ? { currency } : {}),
    ...(mask !== undefined ? { mask } : {}),
  };
}

/** The checks without `detected`: it is its own field (`detected`). */
function checksWithout(checks: FileReview["checks"]): unknown {
  return Object.fromEntries(Object.entries(checks).filter(([key]) => key !== "detected"));
}

function presentParse(
  fileId: string,
  position: number,
  p: FileParse | null,
  review: FileReview | null,
): z.input<typeof parseFileSchema> {
  const refused =
    p?.state === "failed" && p.refusalCode ? parseRefusal(p.refusalCode, storageRejection) : null;
  return {
    fileId,
    position,
    state: p?.state ?? "pending",
    refusal: present(refused),
    recipe: p?.usedRecipeId && p.recipeFormat ? { id: p.usedRecipeId, format: p.recipeFormat } : null,
    accountId: p?.accountId ?? null,
    engineVersion: p?.engineVersion ?? "",
    rowCount: p?.rowCount ?? null,
    checks: review ? (checksWithout(review.checks) as z.input<typeof parseFileSchema>["checks"]) : null,
    history: review ? { ...review.history } : null,
    previousFileId: review?.previousFileId ?? null,
    ...(review ? { detected: presentDetected(review.checks) } : {}),
  };
}

export const getImportBatchParseRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/batches/{batchId}/parse",
  operationId: "getImportBatchParse",
  summary:
    "The parse of each accepted file (FR 5, FR 9, FR 15; IMP-19 FR 4 progress): its state or refusal, recipe, account, engine version, row count, checks and history gap",
  access: READ,
  request: { params: batchParams },
  response: {
    status: 200,
    description: "The batch and its files' parse",
    schema: z.object({
      batch: batchSchema,
      progress: z.object({ pending: z.number().int(), parsed: z.number().int(), failed: z.number().int() }),
      files: z.array(parseFileSchema),
    }),
  },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    importSessionsServices(ctx);
    const view = await guarded(() => ctx.inHousehold((q) => parseViewOf(batchesTx(q), params.batchId)));
    const files = view.files.map((f) => presentParse(f.fileId, f.position, f.parse, f.review));
    const all = await routeTx(ctx)((tx) => tx.files(view.batch.id));
    const count = (state: string) => files.filter((f) => f.state === state).length;
    return {
      batch: presentBatch(view.batch, all),
      progress: { pending: count("pending"), parsed: count("parsed"), failed: count("failed") },
      files,
    };
  },
});

const legSchema = z.object({ amount: z.string(), currency: z.string().nullable() });
const rowSchema = z.object({
  row: z.number().int(),
  date: z.string().nullable(),
  valueDate: z.string().nullable(),
  currency: z.string().nullable(),
  /** Exact decimal text, signed (IMP-02 FR 5, FR 6). */
  legs: z.array(legSchema),
  fee: legSchema.nullable(),
  balance: z.string().nullable(),
  original: legSchema.nullable(),
  rate: z.string().nullable(),
  /** The bank's texts; an IBAN or a card number in them is masked to its last 4 characters. */
  description: z.string().nullable(),
  counterparty: z.string().nullable(),
  reference: z.string().nullable(),
  currencyMark: z.object({ text: z.string(), candidates: z.array(z.string()) }).nullable(),
  flags: z.array(z.string().meta({ "x-extensible-enum": true })),
});

export const listImportFileRowsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/batches/{batchId}/files/{fileId}/rows",
  operationId: "listImportFileRows",
  summary:
    "A parsed file's rows (IMP-02 FR 3–5, IMP-06): each as an event with its legs in exact decimals, a page at a time in the order of the file",
  access: READ,
  list: true,
  request: { params: fileParams, query: pageQuery },
  problems: ["BATCH_STATE_CONFLICT"],
  response: { status: 200, description: "A page of the file's rows", schema: pageOf(rowSchema) },
  handler: async ({ params, query }, ctx) => {
    owner(ctx);
    const { parse } = importSessionsServices(ctx);
    if (!parse) throw new ApiProblem("INTERNAL");
    const after = query.cursor ? decodeCursor(query.cursor, z.object({ r: z.number().int().min(0) })).r : 0;
    const { householdId } = ctx.principal;
    const page = await guarded(() =>
      ctx.inHousehold((q) =>
        rowsOf(
          batchesTx(q),
          (purpose, sealed) => parse.keys.openBytes(householdId, purpose, sealed),
          params.batchId,
          params.fileId,
          { limit: query.limit, after },
        ),
      ),
    );
    return {
      items: page.rows.map((e) => ({
        row: e.row,
        date: e.date,
        valueDate: e.valueDate,
        currency: e.currency,
        legs: e.legs.map((l) => ({ ...l })),
        fee: e.fee ? { ...e.fee } : null,
        balance: e.balance,
        original: e.original ? { ...e.original } : null,
        rate: e.rate,
        description: maskNumbers(e.description),
        counterparty: maskNumbers(e.counterparty),
        reference: maskNumbers(e.reference),
        currencyMark: e.currencyMark
          ? { text: e.currencyMark.text, candidates: [...e.currencyMark.candidates] }
          : null,
        flags: [...e.flags],
      })),
      nextCursor: page.more ? encodeCursor({ r: page.rows.at(-1)!.row }) : null,
    };
  },
});

// ——— «Застосувати» (IMP-01@PoC FR 11; IMP-04@PoC FR 7, AC9; #637) ———

export const applyImportBatchRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/import/batches/{batchId}/apply",
  operationId: "applyImportBatch",
  summary:
    "«Застосувати» (IMP-01 FR 11): the batch's rows become transactions in one write under the locks of its accounts, each duplicate left out; applying it again returns the stored result and writes nothing (IMP-04 FR 7)",
  access: WRITE,
  request: { params: batchParams },
  problems: [
    "BATCH_STATE_CONFLICT",
    "IMPORT_NOT_READY",
    "IMPORT_ROWS_REFUSED",
    "IMPORT_PLAN_TOO_LARGE",
    "IMPORT_APPLY_UNSUPPORTED",
    "ACCOUNT_CLOSED",
    "RATE_LIMITED",
  ],
  response: {
    status: 200,
    description: "The batch, «застосовано», and the stored result of its apply",
    schema: z.object({
      batch: batchSchema,
      /** Counts by outcome (IMP-04: import, repeat, duplicate, already-imported, merge, possible-duplicate, replace) and excluded, zero, files. */
      result: z.object({ counts: z.record(z.string(), z.number().int()) }),
      appliedAt: z.string(),
      /** False — the stored result of an earlier apply: nothing was written now. */
      first: z.boolean(),
    }),
  },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    const { deps, audit, parse, apply } = importSessionsServices(ctx);
    if (!parse || !apply) throw new ApiProblem("INTERNAL");
    const { householdId, userId } = ctx.principal;
    const { result, handOffs } = await guarded(() =>
      applyBatch(
        deps,
        {
          run: (work) => ctx.inHousehold((q) => work(applyTx(q))),
          open: (purpose, sealed) => parse.keys.openBytes(householdId, purpose, sealed),
          write: (input, plan) => apply.transactions.write(householdId, input, plan),
          settle: (input) => apply.transactions.settle(householdId, input),
          plan: (planDeps, request) => planImport(planDeps, householdId, request),
        },
        userId,
        params.batchId,
      ),
    );
    await handOffNow(audit, householdId, handOffs);
    // BUD-01 FR 7 (#722 D): the batch's payments to a credit card from an own account become transfers at once — only
    // by the apply that wrote the batch (a stored result writes nothing, so nothing is marked again). The apply stands
    // either way: a failure here leaves the pairs proposals in «Пари».
    if (result.first && apply.cardPayments)
      await apply.cardPayments
        .markFor(householdId, userId, { importBatchId: params.batchId })
        .catch((error: unknown) =>
          logEvent("import_sessions.card_payment_deferred", "warn", {
            "ws.module": "import-sessions",
            "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
          }),
        );
    const run = routeTx(ctx);
    const batch = await run((tx) => tx.findBatch(params.batchId));
    if (!batch) throw new ApiProblem("NOT_FOUND");
    return {
      batch: presentBatch(batch, await run((tx) => tx.files(batch.id))),
      result: { counts: { ...result.application.result.counts } },
      appliedAt: result.application.appliedAt.toISOString(),
      first: result.first,
    };
  },
});

// ——— Крок «Результат» (IMP-08@PoC FR 11, FR 12, AC7; plan row 138, the server part) ———

const applyCountsSchema = z.object({ counts: z.record(z.string(), z.number().int()) });

export const getImportBatchResultRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/batches/{batchId}/result",
  operationId: "getImportBatchResult",
  summary:
    "The wizard's step «Результат» (IMP-08 FR 11, AC7), read again at any time: the stored result of the batch's apply (created, replaced, skipped rows) and what is left after it as the space is now — card payments recorded as transfers, proposals of transfers with a side of this batch («Пари · N»), the batch's transactions without a category («До розбору»)",
  access: READ,
  request: { params: batchParams },
  problems: ["BATCH_STATE_CONFLICT"],
  response: {
    status: 200,
    description: "The batch, the stored result of its apply and the counts of what is left to do after it",
    schema: z.object({
      batch: batchSchema,
      /** The same counts as the apply's response (IMP-04 outcomes and excluded, zero, files). */
      result: applyCountsSchema,
      appliedAt: z.string(),
      /**
       * What is left after the apply, as the space is now; null — the batch is «відкочено» (`batch.state`
       * `rolled-back`): its transactions are rolled back, nothing is left, and `result` is only the record of the apply.
       */
      followUp: z
        .object({
          /** «N платежів на картку записано як переказ» (IMP-03 FR 15): 0 until the apply records them. */
          cardPaymentTransfers: z.number().int(),
          /** «N пар переказів», «Пари · N»: proposals with a side of this batch; `more` — the read was capped. */
          transferProposals: z.object({ count: z.number().int(), more: z.boolean() }),
          /** «N без категорії» (the queue «До розбору»): shown, not split, no side of a transfer. */
          uncategorized: z.number().int(),
        })
        .nullable(),
    }),
  },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    const { result: services } = importSessionsServices(ctx);
    if (!services) throw new ApiProblem("INTERNAL");
    const { householdId } = ctx.principal;
    const run = routeTx(ctx);
    // The batch of the session's space only: another space's (or none) is «not found» before any module is asked.
    const { batch, application } = await guarded(() =>
      ctx.inHousehold((q) => batchResult(applyTx(q), params.batchId)),
    );
    // #673: a rolled-back batch has nothing left to do — no module is asked, and its old counts are not shown as current.
    const followUp = hasFollowUp(batch)
      ? await followUpOf(
          {
            transactions: (query) => services.transactions.page(householdId, query),
            categoriesOf: (ids) => services.categories.categoriesOf(householdId, ids),
            proposals: (batchId) => services.proposals.countFor(householdId, batchId),
          },
          batch.id,
        )
      : null;
    return {
      batch: presentBatch(batch, await run((tx) => tx.files(batch.id))),
      result: { counts: { ...application.result.counts } },
      appliedAt: application.appliedAt.toISOString(),
      followUp: followUp && {
        cardPaymentTransfers: followUp.cardPaymentTransfers,
        transferProposals: { ...followUp.transferProposals },
        uncategorized: followUp.uncategorized,
      },
    };
  },
});

// ——— «Відкотити» (IMP-04@PoC FR 8, AC7, AC8, AC12; IMP-16@PoC FR 1–5, FR 9; wave 2 row 44) ———

export const rollbackImportBatchRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/import/batches/{batchId}/rollback",
  operationId: "rollbackImportBatch",
  summary:
    "«Відкотити» (IMP-04 FR 8, IMP-16): within 7 days of the apply, every transaction of the batch is rolled back by a reversal in the journal — never deleted — and what was merged into it comes back; ones the person changed are kept with «Залишити змінені» (the default); rolling back again returns the stored result",
  access: WRITE,
  request: {
    params: batchParams,
    body: z.object({
      /** «Залишити змінені» (`keep-changed`, the default) or «Відкотити все» (`all`; IMP-16 FR 4). */
      mode: z.enum(ROLLBACK_MODES).optional(),
    }),
  },
  problems: ["BATCH_STATE_CONFLICT", "IMPORT_ROLLBACK_EXPIRED", "ACCOUNT_CLOSED", "RATE_LIMITED"],
  response: {
    status: 200,
    description: "The batch, «відкочено», and the result of its rollback",
    schema: z.object({
      batch: batchSchema,
      rollback: z.object({
        mode: z.enum(ROLLBACK_MODES),
        /** rolledBack, kept (changed by the person), transfers (sides of a transfer, kept), restored (merged into a rolled-back one, back). */
        counts: z.record(z.string(), z.number().int()),
        /** The transactions kept, at most 200 (the counts name them all). */
        kept: z.array(z.uuid()),
        rolledBackAt: z.string(),
      }),
      /** False — the batch was rolled back before: nothing changed now (IMP-16 FR 3). */
      first: z.boolean(),
    }),
  },
  handler: async ({ params, body }, ctx) => {
    ownerOnly(ctx);
    const { deps, audit, apply } = importSessionsServices(ctx);
    if (!apply) throw new ApiProblem("INTERNAL");
    const { householdId, userId } = ctx.principal;
    const { result, handOffs } = await guarded(() =>
      rollbackBatch(
        deps,
        {
          run: (work) => ctx.inHousehold((q) => work(applyTx(q))),
          rollback: (input) => apply.transactions.rollback(householdId, input),
          rolledBack: (batchId) => apply.transactions.rolledBack(householdId, batchId),
        },
        userId,
        params.batchId,
        body.mode ?? "keep-changed",
      ),
    );
    await handOffNow(audit, householdId, handOffs);
    const run = routeTx(ctx);
    const batch = await run((tx) => tx.findBatch(params.batchId));
    if (!batch) throw new ApiProblem("NOT_FOUND");
    return {
      batch: presentBatch(batch, await run((tx) => tx.files(batch.id))),
      rollback: {
        mode: result.rollback.mode,
        counts: { ...result.rollback.counts },
        kept: [...result.rollback.kept],
        rolledBackAt: result.rollback.rolledBackAt.toISOString(),
      },
      first: result.first,
    };
  },
});

/**
 * IMP-16@PoC FR 4, IMP-04@PoC FR 8 (owner, 2026-11-26, decision 13): what the dialog «Відкотити партію? Буде відкочено
 * N транзакцій; змінені вручну транзакції (M) збережуться» says before it is confirmed. Read like «Результат» (any role
 * of the space, a scoped member — 404): only counts of what the reader may see already; the rollback itself stays the
 * Owner's (`POST …/rollback`).
 */
export const getImportBatchRollbackRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/batches/{batchId}/rollback",
  operationId: "getImportBatchRollback",
  summary:
    "The rollback dialog before it is confirmed (IMP-16 FR 4): how many transactions «Відкотити» takes with «Залишити змінені вручну» on, how many the person changed after the apply (kept with it on, rolled back with it off) and how many are sides of a transfer (kept either way); null while the batch cannot be rolled back (not applied, still applying, past the 7 days or rolled back)",
  access: READ,
  request: { params: batchParams },
  response: {
    status: 200,
    description: "The batch and the counts of its rollback dialog",
    schema: z.object({
      batch: batchSchema,
      rollback: z
        .object({
          /** N: rolled back with «Залишити змінені вручну» on; with it off — `transactions + changed`. */
          transactions: z.number().int(),
          /** M: changed by the person after the apply (a category «вручну», a split, a note of their own). */
          changed: z.number().int(),
          /** Sides of a transfer: kept either way (IMP-16 FR 6). */
          transfers: z.number().int(),
        })
        .nullable(),
    }),
  },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    const { deps, apply } = importSessionsServices(ctx);
    if (!apply) throw new ApiProblem("INTERNAL");
    const run = routeTx(ctx);
    // The batch of the session's space only: another space's (or none) is «not found» before module transactions is asked.
    const batch = await run((tx) => tx.findBatch(params.batchId));
    if (!batch) throw new ApiProblem("NOT_FOUND");
    const open =
      batch.state === "applied" &&
      !batch.applying &&
      !!batch.appliedAt &&
      deps.now() <= rollbackUntil(batch.appliedAt);
    const preview = open
      ? await apply.transactions.rollbackPreview(ctx.principal.householdId, batch.id)
      : null;
    return {
      batch: presentBatch(batch, await run((tx) => tx.files(batch.id))),
      rollback: preview && { ...preview },
    };
  },
});

export const importSessionsRoutes = [
  createImportBatchRoute,
  listImportBatchesRoute,
  getImportBatchRoute,
  uploadImportFilesRoute,
  cancelImportBatchRoute,
  deleteImportBatchRoute,
  linkImportOriginalRoute,
  openImportOriginalRoute,
  decideImportBatchRoute,
  listImportDecisionsRoute,
  importBatchReadinessRoute,
  parseImportBatchRoute,
  getImportBatchParseRoute,
  listImportFileRowsRoute,
  applyImportBatchRoute,
  getImportBatchResultRoute,
  rollbackImportBatchRoute,
  getImportBatchRollbackRoute,
];
