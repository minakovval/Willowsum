// Public interface of the transactions module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import { eraseHouseholdTransactions, transactionsRoutes } from "./adapters/index.ts";

export const transactionsModule = defineModule({
  name: "transactions",
  publishes: [],
  consumes: [],
  routes: transactionsRoutes,
});

export { createTransactionsServices, type TransactionsServices } from "./adapters/index.ts";
export { TRANSACTION_TYPES, typeOf } from "./domain/index.ts";
export type { TransactionType } from "./domain/index.ts";

/** Erasure of a space's transactions (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface TransactionsErasure {
  /** Deletes every transaction of the space and the stored create responses. Idempotent. */
  eraseHousehold(
    householdId: string,
  ): Promise<{ readonly transactions: number; readonly idempotencyKeys: number }>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createTransactionsErasure(db: ModuleDatabase): TransactionsErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdTransactions(db, householdId) };
}
