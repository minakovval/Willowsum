// Registry of backend modules (ARC-01). scripts/new-module.ts adds each new module here; the event
// catalogue and the contract check read this list.
import type { ModuleDefinition } from "../platform/modules/define.ts";
import { planCatalogModule } from "./plan-catalog/index.ts";
import { accessScopeModule } from "./access-scope/index.ts";
import { auditModule } from "./audit/index.ts";

export const modules: readonly ModuleDefinition[] = [
  auditModule,
  accessScopeModule,
  planCatalogModule,
  // new-module: insert above this line
];
