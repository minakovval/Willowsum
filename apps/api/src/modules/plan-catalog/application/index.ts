// Application layer of plan-catalog: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
import { isFeatureKey, type EntitlementSource } from "../domain/index.ts";

/** The entitlement interface (П-21): is a feature available to a space under its plan? */
export interface Entitlements {
  isEnabled(householdId: string, feature: string): Promise<boolean>;
}

export function createEntitlements(source: EntitlementSource): Entitlements {
  return {
    isEnabled: async (_householdId, feature) => {
      // A key outside the catalogue is a programming error, not a «no»: it must fail loudly.
      if (!isFeatureKey(feature)) throw new Error(`Unknown feature key ${feature} (plan-catalog)`);
      switch (source) {
        case "all-enabled":
          return true;
      }
    },
  };
}
