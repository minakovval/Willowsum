import { z } from "zod";
import { decodeCursor, encodeCursor, pageOf, pageQuery } from "../../../../platform/http/pagination.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, DOWNLOAD_RESPONSE, type ProtectedContext } from "../../../../platform/http/route.ts";
import { FileNotFoundError } from "../../../file-storage/index.ts";
import {
  addFiles,
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
} from "../../application/index.ts";
import { BATCH_LIMITS, BATCH_STATES, BatchStateError } from "../../domain/index.ts";
import { batchesTx } from "../db/store.ts";
import { handOffNow, importSessionsServices } from "./services.ts";

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
    files: { accepted, rejected: files.length - accepted },
  };
}

/** A batch (or file) of another space or unknown: one answer, never a hint that it exists. */
function refusal(error: unknown): unknown {
  if (error instanceof BatchNotFoundError || error instanceof FileNotFoundError)
    return new ApiProblem("NOT_FOUND");
  if (error instanceof BatchStateError || error instanceof BatchStateErrorFor)
    return new ApiProblem("BATCH_STATE_CONFLICT");
  return error;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
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

function owner(ctx: ProtectedContext): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
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

export const importSessionsRoutes = [
  createImportBatchRoute,
  listImportBatchesRoute,
  getImportBatchRoute,
  uploadImportFilesRoute,
  cancelImportBatchRoute,
  deleteImportBatchRoute,
  linkImportOriginalRoute,
  openImportOriginalRoute,
];
