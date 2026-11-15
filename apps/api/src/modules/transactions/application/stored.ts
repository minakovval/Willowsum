import type { Money } from "@willowsum/domain-kernel";

/** A transaction as the module stores it (migrations/0001_transactions.sql). */
export interface StoredTransaction {
  readonly id: string;
  readonly accountId: string;
  readonly subaccountId: string;
  /** Signed, in the account's currency. */
  readonly amount: Money;
  readonly date: string;
  readonly counterparty: string | null;
  readonly description: string | null;
  readonly status: "posted";
  readonly source: "manual";
  readonly version: number;
  /** ISO 8601 UTC; set by the database. */
  readonly createdAt: string;
}

export type NewStoredTransaction = Omit<StoredTransaction, "createdAt">;
