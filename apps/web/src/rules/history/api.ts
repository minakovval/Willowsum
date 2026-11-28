import type { ApiClient, operations } from "@willowsum/api-contract";
import { outcome, type Outcome } from "../../auth/api.ts";

/**
 * BUD-21@PoC g) (wave 2, row 239): what the upload of a history file (S-298) and the step «Перевірка розпізнавання»
 * (S-299) read and send on the merged server parts (module `import-sessions`, `history-routes.ts`, rows 233–234; module
 * `categorization`, derivation runs, row 235). The screen computes nothing about money or rules: it shows what the API
 * says about a file, keeps the user's corrections until «Підтвердити» and sends them in one request.
 */
type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } }
  ? B
  : T extends { responses: { 201: { content: { "application/json": infer B } } } }
    ? B
    : never;

export type HistoryView = Json<operations["getHistoryFile"]>;
export type Recognition = NonNullable<HistoryView["recognition"]>;
export type Mapping = NonNullable<Recognition["mapping"]>;
export type MappedLabel = Mapping["labels"][number];
export type MappedGroup = Mapping["groups"][number];
export type Outcome_ = MappedLabel["outcome"];
export type Question = MappedLabel["questions"][number];
export type Uploaded = Json<operations["uploadHistoryFile"]>;
export type Confirmed = Json<operations["confirmHistoryFile"]>;
export type Derivation = Json<operations["getHistoryDerivation"]>;
export type Reread = NonNullable<
  operations["rereadHistoryFile"]["requestBody"]
>["content"]["application/json"];
export type ConfirmBody = operations["confirmHistoryFile"]["requestBody"]["content"]["application/json"];
export type LabelAnswer = NonNullable<ConfirmBody["labels"]>[number];
export type Failed = Exclude<Outcome<unknown>, { ok: true }>;

/** BUD-21 FR 3: the ceiling the picker names before sending (the server's own is the rule). */
export const MAX_HISTORY_BYTES = 25 * 1024 * 1024;

export function uploadHistoryFile(api: ApiClient, file: File): Promise<Outcome<Uploaded>> {
  const form = new FormData();
  form.append("files", file, file.name);
  return outcome(api.POST("/v1/import/history-files", { body: { files: [] }, bodySerializer: () => form }));
}

export const loadHistoryFile = (api: ApiClient, batchId: string): Promise<Outcome<HistoryView>> =>
  outcome(api.GET("/v1/import/history-files/{batchId}", { params: { path: { batchId } } }));

export const rereadHistoryFile = (
  api: ApiClient,
  batchId: string,
  body: Reread,
): Promise<Outcome<HistoryView>> =>
  outcome(api.POST("/v1/import/history-files/{batchId}/reading", { params: { path: { batchId } }, body }));

export const confirmHistoryFile = (
  api: ApiClient,
  batchId: string,
  body: ConfirmBody,
): Promise<Outcome<Confirmed>> =>
  outcome(api.POST("/v1/import/history-files/{batchId}/confirm", { params: { path: { batchId } }, body }));

export const deleteHistoryFile = (api: ApiClient, batchId: string): Promise<Outcome<unknown>> =>
  outcome(api.DELETE("/v1/import/history-files/{batchId}", { params: { path: { batchId } } }));

export const loadDerivation = (api: ApiClient, derivationId: string): Promise<Outcome<Derivation>> =>
  outcome(api.GET("/v1/category-rule-derivations/{derivationId}", { params: { path: { derivationId } } }));

export const startDerivation = (api: ApiClient, batchId: string) =>
  outcome(api.POST("/v1/category-rule-derivations", { body: { batchId } }));

/** The refusal an upload carries (`rejection.code`, as the import wizard reads it). */
export function rejectionCode(o: Failed): string | null {
  if (o.kind !== "problem") return null;
  const r = (o.problem as unknown as { rejection?: { code?: string } }).rejection;
  return r?.code ?? null;
}
