import { describe, expect, it } from "vitest";
import { PLAN_ENTITLEMENT_SOURCES } from "../../platform/config/config.ts";
import { createEntitlements, ENTITLEMENT_SOURCES, FEATURE_KEYS, planCatalogModule } from "./index.ts";

const household = "3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01";

describe("plan-catalog: the entitlement interface (П-21, П-24)", () => {
  it("declares its public interface", () => {
    expect(planCatalogModule.name).toBe("plan-catalog");
  });

  it("PoC: every feature of the catalogue is enabled by configuration", async () => {
    const entitlements = createEntitlements("all-enabled");
    for (const key of FEATURE_KEYS) expect(await entitlements.isEnabled(household, key)).toBe(true);
  });

  it("a key outside the catalogue is an error, not a silent yes or no", async () => {
    await expect(createEntitlements("all-enabled").isEnabled(household, "nope")).rejects.toThrow(
      /Unknown feature key/,
    );
  });

  it("the configuration accepts exactly the entitlement sources of this module", () => {
    expect([...PLAN_ENTITLEMENT_SOURCES]).toEqual([...ENTITLEMENT_SOURCES]);
  });
});
