import { describe, expect, it } from "vitest";
import { duplicateMatchingModule } from "./index.ts";

describe("duplicate-matching module", () => {
  it("declares its public interface", () => {
    expect(duplicateMatchingModule.name).toBe("duplicate-matching");
  });
});
