import { describe, expect, it } from "vitest";
import { budgetModule } from "./index.ts";

describe("budget module", () => {
  it("declares its public interface", () => {
    expect(budgetModule.name).toBe("budget");
  });
});
