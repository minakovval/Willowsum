import type { ApiClient, operations } from "@willowsum/api-contract";
import type { MessageKey } from "@willowsum/i18n";
import { outcome, type Outcome } from "../auth/api.ts";
import { failureOf, type Failure } from "../auth/failure.ts";

/**
 * BUD-13@PoC b), FIN-03@PoC e) (wave 2, row 117): the merged API of «Розділити» (FIN-03 b, #297) for «Розділити
 * транзакцію» (S-049), opened from the details of a transaction (S-047).
 */
type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;
type BodyOf<T> = T extends { requestBody: { content: { "application/json": infer B } } } ? B : never;

export type Transaction = Json<operations["getTransaction"]>;
export type SplitBody = BodyOf<operations["splitTransaction"]>;

/** A category a part may take: of the transaction's type, not a service one, not hidden (BUD-01 FR 6). */
export interface SplitCategory {
  readonly id: string;
  readonly name: string;
  readonly kind: "expense" | "income" | "service";
}

/** «Зберегти» of the dialog on the API (FIN-03 b, #297); the details screen (row 116) passes it as `onSave`. */
export const splitAction =
  (api: ApiClient, id: string) =>
  (body: SplitBody): Promise<Outcome<Transaction>> =>
    outcome(
      api.POST("/v1/transactions/{transactionId}/split", { params: { path: { transactionId: id } }, body }),
    );

const PROBLEM_KEYS: Readonly<Record<string, MessageKey>> = {
  ACCOUNT_CLOSED: "tx.error.accountClosed",
  TRANSACTION_MERGED: "tx.error.merged",
  TRANSACTION_IN_TRANSFER: "tx.error.transfer",
};

/** The text of a failed change: the module's own codes first, then the common ones (ARC-09 FR 3 «Код: …»). */
export function changeFailure(o: Exclude<Outcome<unknown>, { ok: true }>): Failure {
  if (o.kind === "problem") {
    const key = PROBLEM_KEYS[o.problem.code];
    if (key) return { key, code: o.supportId };
    if (o.problem.code === "VALIDATION_FAILED") return { key: "tx.error.invalid", code: o.supportId };
  }
  return failureOf(o);
}
