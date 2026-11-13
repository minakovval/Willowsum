// Registry of backend modules (ARC-01). scripts/new-module.ts adds each new module here; the event
// catalogue and the contract check read this list.
import type { ModuleDefinition } from "../platform/modules/define.ts";
import { notificationDeliveryModule } from "./notification-delivery/index.ts";
import { staffAdminModule } from "./staff-admin/index.ts";
import { fileStorageModule } from "./file-storage/index.ts";
import { importRecipesModule } from "./import-recipes/index.ts";
import { fileParsersModule } from "./file-parsers/index.ts";
import { importSessionsModule } from "./import-sessions/index.ts";
import { reportsModule } from "./reports/index.ts";
import { debtPayoffModule } from "./debt-payoff/index.ts";
import { cashflowModule } from "./cashflow/index.ts";
import { recurringModule } from "./recurring/index.ts";
import { goalsModule } from "./goals/index.ts";
import { budgetModule } from "./budget/index.ts";
import { bulkActionsModule } from "./bulk-actions/index.ts";
import { transferMatchingModule } from "./transfer-matching/index.ts";
import { duplicateMatchingModule } from "./duplicate-matching/index.ts";
import { merchantsModule } from "./merchants/index.ts";
import { categorizationModule } from "./categorization/index.ts";
import { categoriesModule } from "./categories/index.ts";
import { transactionsModule } from "./transactions/index.ts";
import { liabilitiesModule } from "./liabilities/index.ts";
import { accountsModule } from "./accounts/index.ts";
import { dataErasureModule } from "./data-erasure/index.ts";
import { ledgerModule } from "./ledger/index.ts";
import { fxRatesModule } from "./fx-rates/index.ts";
import { householdModule } from "./household/index.ts";
import { identityModule } from "./identity/index.ts";
import { featureFlagsModule } from "./feature-flags/index.ts";
import { planCatalogModule } from "./plan-catalog/index.ts";
import { accessScopeModule } from "./access-scope/index.ts";
import { auditModule } from "./audit/index.ts";

export const modules: readonly ModuleDefinition[] = [
  auditModule,
  accessScopeModule,
  planCatalogModule,
  featureFlagsModule,
  identityModule,
  householdModule,
  fxRatesModule,
  ledgerModule,
  dataErasureModule,
  accountsModule,
  liabilitiesModule,
  transactionsModule,
  categoriesModule,
  categorizationModule,
  merchantsModule,
  duplicateMatchingModule,
  transferMatchingModule,
  bulkActionsModule,
  budgetModule,
  goalsModule,
  recurringModule,
  cashflowModule,
  debtPayoffModule,
  reportsModule,
  importSessionsModule,
  fileParsersModule,
  importRecipesModule,
  fileStorageModule,
  staffAdminModule,
  notificationDeliveryModule,
  // new-module: insert above this line
];
