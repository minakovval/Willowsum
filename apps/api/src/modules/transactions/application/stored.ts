import type { Money } from "@willowsum/domain-kernel";
import type { Split, TransactionStatus, TransferLink } from "../domain/index.ts";

/** A transaction as the module stores it (migrations/0001_transactions.sql, 0004_states_and_splits.sql). */
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
  readonly source: "manual";
  /** FIN-03 FR 16, FR 17: out of the list, the budget and the reports; its journal event (the balance) stays. */
  readonly hidden: boolean;
  /** BUD-13 FR 6–8: the budget's view of the amount; null — not split. */
  readonly split: Split | null;
  /** FIN-03 FR 7: the transfer between own accounts it is a side of; null — none (domain/transfers.ts). */
  readonly transfer: TransferLink | null;
  readonly version: number;
  /** ISO 8601 UTC; set by the database. */
  readonly createdAt: string;
}

export type NewStoredTransaction = Omit<StoredTransaction, "createdAt">;
