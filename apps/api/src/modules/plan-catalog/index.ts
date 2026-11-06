// Public interface of the plan-catalog module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const planCatalogModule = defineModule({
  name: "plan-catalog",
  publishes: [],
  consumes: [],
});

export { createEntitlements, type Entitlements } from "./application/index.ts";
export { ENTITLEMENT_SOURCES, FEATURE_KEYS, FEATURES } from "./domain/index.ts";
export type { EntitlementSource, FeatureKey } from "./domain/index.ts";
