// Adapters of accounts: database (ModuleDatabase, schema «accounts»), HTTP, external services.
export { accountsTx } from "./db/store.ts";
export { accountsRoutes, createAccountsServices, type AccountsServices } from "./http/index.ts";
