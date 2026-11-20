import type { ApiClient, operations } from "@willowsum/api-contract";
import { outcome, type Outcome } from "../auth/api.ts";
import type { Json } from "./api.ts";

/**
 * IMP-08@PoC b) (wave 2, row 137): what the step «Перевірка розпізнавання» (S-171) reads and sends. The routes are the
 * import-sessions module's review API (#668): the rows of a file under the batch's decisions, the file's review (counts,
 * the group «знак не підтверджено», the engine's decisions), the rows' values and the preview of the duplicates. Every
 * sum, balance and difference shown comes from these answers; the screen does no money arithmetic.
 */
export type ReviewRows = Json<operations["listImportReviewRows"]>;
export type ReviewRow = ReviewRows["items"][number];
export type ReviewFilter = NonNullable<
  NonNullable<operations["listImportReviewRows"]["parameters"]["query"]>["filter"]
>;
export type FileReview = Json<operations["getImportFileReview"]>;
export type FileRows = Json<operations["listImportFileRows"]>;
export type FileRow = FileRows["items"][number];
export type DuplicatePage = Json<operations["listImportDuplicatePreview"]>;
export type Duplicate = DuplicatePage["items"][number];
export type Evidence = NonNullable<ReviewRow["reading"]>["evidence"][number];

type DecisionBody = NonNullable<
  operations["decideImportBatch"]["requestBody"]
>["content"]["application/json"];
export type DecisionInput = DecisionBody["decisions"][number];

/** The rows of a page: a page of the review rows holds at most this many (ARC-07 FR 4; the API's ceiling is 100). */
export const PAGE = 50;
/** A file has at most 20 000 rows (IMP-01 FR 13): the most pages the values and the duplicates are read for. */
const MAX_PAGES = 200;

export const loadReview = (api: ApiClient, batchId: string, fileId: string): Promise<Outcome<FileReview>> =>
  outcome(
    api.GET("/v1/import/batches/{batchId}/files/{fileId}/review", { params: { path: { batchId, fileId } } }),
  );

export const loadReviewRows = (
  api: ApiClient,
  batchId: string,
  fileId: string,
  filter: ReviewFilter | undefined,
  cursor: string | null,
): Promise<Outcome<ReviewRows>> =>
  outcome(
    api.GET("/v1/import/batches/{batchId}/files/{fileId}/review/rows", {
      params: {
        path: { batchId, fileId },
        query: { limit: PAGE, ...(filter ? { filter } : {}), ...(cursor ? { cursor } : {}) },
      },
    }),
  );

export const loadFileRows = (
  api: ApiClient,
  batchId: string,
  fileId: string,
  cursor: string | null,
): Promise<Outcome<FileRows>> =>
  outcome(
    api.GET("/v1/import/batches/{batchId}/files/{fileId}/rows", {
      params: { path: { batchId, fileId }, query: { limit: 100, ...(cursor ? { cursor } : {}) } },
    }),
  );

/** The whole duplicate preview of a file, page by page (it is small next to the rows: only rows the apply would not write as new). */
export async function loadDuplicates(
  api: ApiClient,
  batchId: string,
  fileId: string,
): Promise<Outcome<{ items: readonly Duplicate[]; afterEarlierFile: boolean }>> {
  const items: Duplicate[] = [];
  let cursor: string | undefined;
  let afterEarlierFile = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const o = await outcome(
      api.GET("/v1/import/batches/{batchId}/files/{fileId}/duplicates", {
        params: { path: { batchId, fileId }, query: { limit: 100, ...(cursor ? { cursor } : {}) } },
      }),
    );
    if (!o.ok) return o;
    items.push(...o.data.items);
    afterEarlierFile = o.data.afterEarlierFile;
    cursor = o.data.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return { ok: true, data: { items, afterEarlierFile } };
}

/** The answers of the person (IMP-05 FR 10): a row's, a group's, a flag's, a balance choice, the order of day and month. */
export const decide = (
  api: ApiClient,
  batchId: string,
  decisions: readonly DecisionInput[],
): Promise<Outcome<unknown>> =>
  outcome(
    api.POST("/v1/import/batches/{batchId}/decisions", {
      params: { path: { batchId } },
      body: { decisions: [...decisions] },
    }),
  );
