// Public interface of the accounts module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import { accountsRoutes, eraseHouseholdAccounts } from "./adapters/index.ts";

export const accountsModule = defineModule({
  name: "accounts",
  publishes: [],
  consumes: [],
  routes: accountsRoutes,
});

export { createAccountsServices, type AccountsServices } from "./adapters/index.ts";
export { NUMBER_FIELD } from "./application/index.ts";
export type { AccountView, NumberSeal } from "./application/index.ts";
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
