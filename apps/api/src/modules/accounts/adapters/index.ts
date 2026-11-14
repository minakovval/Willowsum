// Adapters of accounts: database (ModuleDatabase, schema «accounts»), HTTP, external services.
export { eraseHouseholdAccounts } from "./db/erasure.ts";
export { accountsTx } from "./db/store.ts";
export { accountsRoutes, createAccountsServices, type AccountsServices } from "./http/index.ts";
