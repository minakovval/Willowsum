// Domain layer of plan-catalog: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export { ENTITLEMENT_SOURCES, FEATURE_KEYS, FEATURES, isFeatureKey } from "./features.ts";
export type { EntitlementSource, FeatureKey } from "./features.ts";
