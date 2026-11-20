import type { ApiClient, operations } from "@willowsum/api-contract";
import { outcome, type Outcome } from "../auth/api.ts";

/**
 * IMP-08@PoC a) (wave 2, row 136): what the wizard step «Рахунок і файли» (S-170) reads and sends. The routes are the
 * import-sessions module's (IMP-01@PoC, wave 2 rows 39–42): a batch, its files, the parse of each file and the readiness
 * (its «Підтвердіть рахунок» entry carries the masked evidence and the suggested account). The screen computes nothing
 * with money: it shows what the API says about a file and counts files.
 */
export type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } }
  ? B
  : T extends { responses: { 201: { content: { "application/json": infer B } } } }
    ? B
    : never;

export type Batch = Json<operations["createImportBatch"]>;
export type Upload = Json<operations["uploadImportFiles"]>;
export type BatchFile = Upload["files"][number];
export type Refused = Upload["refused"][number];
export type Rejection = Refused["rejection"];
export type ParseView = Json<operations["getImportBatchParse"]>;
export type FileParse = ParseView["files"][number];
export type Readiness = Json<operations["getImportBatchReadiness"]>;
export type AccountRefusal = Extract<
  Readiness["refusals"][number],
  { code: "confirm-account" }
>["files"][number];
export type AccountItem = Json<operations["listAccounts"]>["items"][number];
export type BatchDetail = Json<operations["getImportBatch"]>;

/** IMP-01@PoC FR 13: the ceilings the picker names before sending (the server's own are the rule). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 50;

export type Failed = Exclude<Outcome<unknown>, { ok: true }>;

export const createBatch = (api: ApiClient): Promise<Outcome<Batch>> =>
  outcome(api.POST("/v1/import/batches", { body: {} }));

/** Sends the files as one multipart request (`files` field, FR 3); the server answers for each file apart (FR 6). */
export function uploadFiles(
  api: ApiClient,
  batchId: string,
  files: readonly File[],
): Promise<Outcome<Upload>> {
  const form = new FormData();
  for (const f of files) form.append("files", f, f.name);
  return outcome(
    api.POST("/v1/import/batches/{batchId}/files", {
      params: { path: { batchId } },
      body: { files: [] },
      bodySerializer: () => form,
    }),
  );
}

/** Starts the parse of the given files; the account is the user's choice, or omitted (the engine matches it, FR 2). */
export const startParse = (
  api: ApiClient,
  batchId: string,
  files: readonly { fileId: string; accountId?: string }[],
): Promise<Outcome<Batch>> =>
  outcome(
    api.POST("/v1/import/batches/{batchId}/parse", {
      params: { path: { batchId } },
      body: {
        files: files.map((f) => ({ fileId: f.fileId, ...(f.accountId ? { accountId: f.accountId } : {}) })),
      },
    }),
  );

export const loadBatch = (api: ApiClient, batchId: string): Promise<Outcome<BatchDetail>> =>
  outcome(api.GET("/v1/import/batches/{batchId}", { params: { path: { batchId } } }));

export const loadParse = (api: ApiClient, batchId: string): Promise<Outcome<ParseView>> =>
  outcome(api.GET("/v1/import/batches/{batchId}/parse", { params: { path: { batchId } } }));

export const loadReadiness = (api: ApiClient, batchId: string): Promise<Outcome<Readiness>> =>
  outcome(api.GET("/v1/import/batches/{batchId}/readiness", { params: { path: { batchId } } }));

/** The most pages read for the list of accounts: 100 rows each, far above any household's accounts. */
const MAX_PAGES = 20;

/** The active accounts of the space (FR 2: closed ones are not offered), page by page. */
export async function loadActiveAccounts(api: ApiClient): Promise<Outcome<readonly AccountItem[]>> {
  const rows: AccountItem[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const o = await outcome(
      api.GET("/v1/accounts", { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } }),
    );
    if (!o.ok) return o;
    rows.push(...o.data.items.filter((a) => a.status === "active"));
    cursor = o.data.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return { ok: true, data: rows };
}

/** The reason a problem carries when every file of an upload was rejected (IMP-01 FR 6: 413 or 422, `rejection`). */
export function problemRejection(o: Failed): { code: string } | null {
  if (o.kind !== "problem") return null;
  const r = (o.problem as unknown as { rejection?: { code?: string } }).rejection;
  return r?.code ? { code: r.code } : null;
}

/** «Підтвердіть рахунок» (IMP-05 FR 4): the user confirms the account the file was parsed for. */
export const confirmAccount = (api: ApiClient, batchId: string, fileId: string): Promise<Outcome<unknown>> =>
  outcome(
    api.POST("/v1/import/batches/{batchId}/decisions", {
      params: { path: { batchId } },
      body: { decisions: [{ kind: "account", fileId }] },
    }),
  );

/** «Скасувати» (IMP-01 FR 12): the open batch closes, nothing is written. */
export const cancelBatch = (api: ApiClient, batchId: string): Promise<Outcome<Batch>> =>
  outcome(api.POST("/v1/import/batches/{batchId}/cancel", { params: { path: { batchId } } }));
