// Public interface of the accounts module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { Money } from "@willowsum/domain-kernel";
import {
  accountsRoutes,
  accountsTx,
  eraseHouseholdAccounts,
  type AccountsServices,
} from "./adapters/index.ts";
import { reconcileStatement, type StatementResult } from "./application/index.ts";

export const accountsModule = defineModule({
  name: "accounts",
  publishes: [],
  consumes: [],
  routes: accountsRoutes,
});

export { createAccountsServices, type AccountsServices } from "./adapters/index.ts";
export { NUMBER_FIELD } from "./application/index.ts";
export type { AccountView, NumberSeal, StatementResult } from "./application/index.ts";
export { ACCOUNT_KINDS, depositAccrual, groupOf, maskedNumber, parseAccountNumber } from "./domain/index.ts";
export type { AccountGroup, AccountKind, DepositAccrual } from "./domain/index.ts";

/** Erasure of a space's accounts (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface AccountsErasure {
  /** Deletes every account of the space with its subaccounts, owners and stored create responses. Idempotent. */
  eraseHousehold(
    householdId: string,
  ): Promise<{ readonly accounts: number; readonly idempotencyKeys: number }>;
}

/** `db` is the accounts module's own database (`ModuleDatabases.for("accounts")`). */
export function createAccountsErasure(db: ModuleDatabase): AccountsErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdAccounts(db, householdId) };
}

/**
 * The recount of a temporary adjustment by an imported statement with a closing balance (FIN-12@PoC FR 15), for the
 * import of statements: `reconcile` in the accounts transaction with the account locked. A manual account's adjustment
 * is permanent and never recounted; without an adjustment nothing is created (FIN-04 FR 11).
 */
export interface AccountStatements {
  reconcile(
    householdId: string,
    statement: { readonly accountId: string; readonly statementEnd: string; readonly closingBalance: Money },
  ): Promise<StatementResult>;
}

/** `db` is the accounts module's own database; `services` the same as the routes'. */
export function createAccountStatements(db: ModuleDatabase, services: AccountsServices): AccountStatements {
  return {
    reconcile: (householdId, statement) =>
      db.inHousehold(householdId, (q) =>
        reconcileStatement(services.deps, accountsTx(q), householdId, statement),
      ),
  };
}
