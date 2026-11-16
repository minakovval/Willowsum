import type { ApiClient, operations } from "@willowsum/api-contract";
import type { MessageKey } from "@willowsum/i18n";
import { outcome, type Outcome } from "../auth/api.ts";
import { failureOf, type Failure } from "../auth/failure.ts";

/**
 * BUD-13@PoC b), FIN-03@PoC e) (wave 2, row 117): the merged API of «Розділити» (FIN-03 b, #297) and the attributes
 * (BUD-13 a, #327) for the details of a transaction (S-047) and «Розділити транзакцію» (S-049).
 */
type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;
type BodyOf<T> = T extends { requestBody: { content: { "application/json": infer B } } } ? B : never;

export type Transaction = Json<operations["getTransaction"]>;
export type SpaceTag = Json<operations["listTransactionTags"]>["items"][number];
export type SplitBody = BodyOf<operations["splitTransaction"]>;
export type AttributesBody = BodyOf<operations["setTransactionAttributes"]>;

/** A category a part may take: of the transaction's type, not a service one, not hidden (BUD-01 FR 6). */
export interface SplitCategory {
  readonly id: string;
  readonly name: string;
  readonly kind: "expense" | "income" | "service";
}

/** What the details and the dialog do; the screen gives the API's, the gallery its own (synthetic values). */
export interface TransactionActions {
  readonly split: (body: SplitBody) => Promise<Outcome<Transaction>>;
  readonly unsplit: () => Promise<Outcome<Transaction>>;
  readonly saveAttributes: (body: AttributesBody) => Promise<Outcome<Transaction>>;
}

export function transactionActions(api: ApiClient, id: string): TransactionActions {
  const params = { path: { transactionId: id } };
  return {
    split: (body) => outcome(api.POST("/v1/transactions/{transactionId}/split", { params, body })),
    unsplit: () => outcome(api.DELETE("/v1/transactions/{transactionId}/split", { params })),
    saveAttributes: (body) =>
      outcome(api.PATCH("/v1/transactions/{transactionId}/attributes", { params, body })),
  };
}

/** The space's tags for the suggestions of «+ Тег»; a failure leaves them out (the field still takes a new name). */
export async function loadTags(api: ApiClient): Promise<readonly SpaceTag[]> {
  const o = await outcome(api.GET("/v1/transaction-tags"));
  return o.ok ? o.data.items : [];
}

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
    if (o.problem.code === "VALIDATION_FAILED") {
      const tooMany = o.problem.errors?.some((e) => e.path === "tags");
      return { key: tooMany ? "tx.tags.limit" : "tx.error.invalid", code: o.supportId };
    }
  }
  return failureOf(o);
}
