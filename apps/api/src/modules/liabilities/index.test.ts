import { describe, expect, it } from "vitest";
import { liabilitiesModule } from "./index.ts";

describe("liabilities module", () => {
  it("declares its public interface", () => {
    expect(liabilitiesModule.name).toBe("liabilities");
  });
});
