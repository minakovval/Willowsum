import { describe, expect, it } from "vitest";
import { featureFlagsModule } from "./index.ts";

describe("feature-flags module", () => {
  it("declares its public interface", () => {
    expect(featureFlagsModule.name).toBe("feature-flags");
  });
});
