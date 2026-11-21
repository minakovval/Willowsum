import type { Money } from "@willowsum/domain-kernel";
import type { ReviewState, Split, TransactionStatus, TransferLink } from "../domain/index.ts";

/** A transaction as the module stores it (migrations/0001_transactions.sql, 0004_states_and_splits.sql, 0007_attributes.sql, 0008_review.sql, 0013_one_off.sql). */
export interface StoredTransaction {
  readonly id: string;
  readonly accountId: string;
  readonly subaccountId: string;
  /** Signed, in the account's currency. */
  readonly amount: Money;
  readonly date: string;
  readonly counterparty: string | null;
  readonly description: string | null;
  /** FIN-03 FR 24: «Очікує» has no journal event until it is posted (FR 4). */
  readonly status: TransactionStatus;
  /** «imported» — a row of a statement file written by the apply of an import batch (IMP-01@PoC FR 11). */
  readonly source: "manual" | "imported";
  /** FIN-03 FR 16, FR 17: out of the list, the budget and the reports; a manual one (a duplicate) also leaves the balance, an imported one keeps its journal event. */
  readonly hidden: boolean;
  /** BUD-13 FR 6–8: the budget's view of the amount; null — not split. */
  readonly split: Split | null;
  /** FIN-03 FR 7: the transfer between own accounts it is a side of; null — none (domain/transfers.ts). */
  readonly transfer: TransferLink | null;
  /**
   * FIN-03 FR 11, FR 12: the transaction this one was merged into as its duplicate («Об'єднати»): hidden, without its own
   * journal event until «Роз'єднати»; null — not merged.
   */
  readonly mergedInto: string | null;
  /** BUD-13 FR 1: «Нотатка»; null — none. */
  readonly note: string | null;
  /** BUD-13 FR 2: the space's tags of the transaction (`tags`), in the order given; at most 20. */
  readonly tagIds: readonly string[];
  /**
   * BUD-06@PoC FR 8 «Одноразова витрата» (0013_one_off.sql): it stays in the fact of its period, but leaves the averages
   * (BUD-06 FR 4, BUD-02 «Створити за моїми витратами», BUD-05 «Подушка безпеки»).
   */
  readonly oneOff: boolean;
  /** BUD-12 FR 4, FR 8: «До розбору» — `queued`, its category `confirmed`, or null: never in the queue. */
  readonly review: ReviewState | null;
  readonly version: number;
  /** ISO 8601 UTC; set by the database. */
  readonly createdAt: string;
}

export type NewStoredTransaction = Omit<StoredTransaction, "createdAt">;
