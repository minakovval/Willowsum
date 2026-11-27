import type { ApiClient, operations } from "@willowsum/api-contract";
import { outcome, type Outcome } from "../auth/api.ts";
import type { Json } from "./api.ts";

/**
 * IMP-08@PoC c) (wave 2, row 138): what the step «Результат» (S-174) reads and sends — the import-sessions module's apply
 * (`POST …/apply`, IMP-01 / IMP-05 FR 11, idempotent: IMP-04 FR 7), the result of the apply with what is left to do after it
 * (`GET …/result`, #673) and the rollback (`POST …/rollback`, IMP-04 FR 8, #666). Every number shown is the API's whole
 * number; the screen adds up row counts of one kind (never money) and does no money arithmetic.
 */
export type Applied = Json<operations["applyImportBatch"]>;
export type BatchResult = Json<operations["getImportBatchResult"]>;
export type FollowUp = NonNullable<BatchResult["followUp"]>;
export type RollbackBody = NonNullable<
  operations["rollbackImportBatch"]["requestBody"]
>["content"]["application/json"];
export type RollbackMode = NonNullable<RollbackBody["mode"]>;
export type RollbackCounts = NonNullable<Json<operations["getImportBatchRollback"]>["rollback"]>;
export type RolledBack = Json<operations["rollbackImportBatch"]>;

/** Applies the reviewed batch: all rows or none (IMP-05 FR 11); a second call returns the stored result (`first: false`). */
export const applyBatch = (api: ApiClient, batchId: string): Promise<Outcome<Applied>> =>
  outcome(api.POST("/v1/import/batches/{batchId}/apply", { params: { path: { batchId } } }));

export const loadResult = (api: ApiClient, batchId: string): Promise<Outcome<BatchResult>> =>
  outcome(api.GET("/v1/import/batches/{batchId}/result", { params: { path: { batchId } } }));

/** «Відкотити» (IMP-04 FR 8): «Залишити змінені» (`keep-changed`) or «Відкотити все» (`all`). */
export const rollbackBatch = (
  api: ApiClient,
  batchId: string,
  mode: RollbackMode,
): Promise<Outcome<RolledBack>> =>
  outcome(
    api.POST("/v1/import/batches/{batchId}/rollback", { params: { path: { batchId } }, body: { mode } }),
  );

/**
 * The counts of the rollback dialog (IMP-16 FR 4, IMP-04 FR 8; `GET …/rollback`, #728): `transactions` roll back with
 * «Залишити змінені вручну» on, `changed` were changed by hand (kept with it on, rolled back with it off), `transfers` are
 * sides of a transfer (kept either way). `null` — the batch cannot be rolled back any more.
 */
export const loadRollbackCounts = (
  api: ApiClient,
  batchId: string,
): Promise<Outcome<Json<operations["getImportBatchRollback"]>>> =>
  outcome(api.GET("/v1/import/batches/{batchId}/rollback", { params: { path: { batchId } } }));
