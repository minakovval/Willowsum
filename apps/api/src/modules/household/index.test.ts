import { describe, expect, it } from "vitest";
import { householdModule } from "./index.ts";

describe("household module", () => {
  it("declares its public interface", () => {
    expect(householdModule.name).toBe("household");
  });
});
