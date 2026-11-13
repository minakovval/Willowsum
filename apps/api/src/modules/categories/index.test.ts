import { describe, expect, it } from "vitest";
import { categoriesModule } from "./index.ts";

describe("categories module", () => {
  it("declares its public interface", () => {
    expect(categoriesModule.name).toBe("categories");
  });
});
