// Registry of backend modules (ARC-01). scripts/new-module.ts adds each new module here; the event
// catalogue and the contract check read this list.
import type { ModuleDefinition } from "../platform/modules/define.ts";
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
  // new-module: insert above this line
];
