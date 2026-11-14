// Public interface of the accounts module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";
import { accountsRoutes } from "./adapters/index.ts";

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
