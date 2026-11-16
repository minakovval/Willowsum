import { confirmReview, reopenReview } from "../domain/index.ts";
import { transactionAuditValues, type TransactionHandOff } from "./hand-off.ts";
import type { Caller, TransactionsTx } from "./transactions.ts";
import type { StoredTransaction } from "./stored.ts";

/**
 * «До розбору» (BUD-12@PoC a; wave 2 row 24): «Підтвердити» on a card and «Відмінити» of it (FR 4, FR 6, FR 7). The
 * confirmation is of the category (FR 4: no status «переглянуто» of its own): the row's `review` becomes `confirmed`
 * and it leaves the queue; «Змінити категорію» is the category set by module categorization, then this confirmation.
 * «Пропустити» (FR 5) changes nothing on the server.
 *
 * Each is one change of the row under its lock, against the version the card shows (FR 7: changed in another window or
 * by the bank meanwhile — refused, nothing written), with its hand-off: the audit entry `update` with the field
 * `review` — who and when (FR 4, FR 10). The journal is not touched. A confirmation is no change of the account's
 * records, so a transaction on a closed account is confirmed too (as its category changes, module categorization):
 * otherwise it would stay in the queue for good.
 */
export type ReviewStep = "confirm" | "reopen";

export type ReviewResult =
  | {
      readonly kind: "ok";
      readonly transaction: StoredTransaction;
      /** Run it once the transaction has committed (ARC-04 FR 2); null — nothing changed. */
      readonly handOff: TransactionHandOff | null;
    }
  /** FR 7: the transaction is not at the version the card shows; nothing was written. */
  | { readonly kind: "conflict"; readonly version: number }
  /** FR 8: never in the queue (entered by hand); nothing was written. */
  | { readonly kind: "not-queued" }
  /** FIN-03 FR 11: a merged duplicate changes only through «Роз'єднати». */
  | { readonly kind: "merged" }
  | { readonly kind: "not-found" };

export async function setReview(
  tx: TransactionsTx,
  caller: Caller,
  id: string,
  expectedVersion: number,
  step: ReviewStep,
): Promise<ReviewResult> {
  const current = await tx.lock(caller.householdId, id);
  if (!current) return { kind: "not-found" };
  if (current.version !== expectedVersion) return { kind: "conflict", version: current.version };
  if (current.mergedInto !== null) return { kind: "merged" };
  const next = step === "confirm" ? confirmReview(current.review) : reopenReview(current.review);
  if (next === "not-queued") return { kind: "not-queued" };
  if (next === "unchanged") return { kind: "ok", transaction: current, handOff: null };
  const row = await tx.update(caller.householdId, { ...current, review: next, version: current.version + 1 });
  // An `update` of the transaction (the worker of an earlier version knows it), told apart by its field `review`.
  const handOff: TransactionHandOff = {
    transactionId: row.id,
    actorAccountId: caller.accountId,
    action: "update",
    version: row.version,
    audit: transactionAuditValues("update", current, row),
  };
  await tx.enqueueHandOff(caller.householdId, handOff);
  return { kind: "ok", transaction: row, handOff };
}
