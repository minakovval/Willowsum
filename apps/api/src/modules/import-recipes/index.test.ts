import { describe, expect, it } from "vitest";
import { importRecipesModule } from "./index.ts";

describe("import-recipes module", () => {
  it("declares its public interface", () => {
    expect(importRecipesModule.name).toBe("import-recipes");
  });
});
