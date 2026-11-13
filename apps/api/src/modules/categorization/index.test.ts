import { describe, expect, it } from "vitest";
import { categorizationModule } from "./index.ts";

describe("categorization module", () => {
  it("declares its public interface", () => {
    expect(categorizationModule.name).toBe("categorization");
  });
});
