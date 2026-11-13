import { describe, expect, it } from "vitest";
import { transferMatchingModule } from "./index.ts";

describe("transfer-matching module", () => {
  it("declares its public interface", () => {
    expect(transferMatchingModule.name).toBe("transfer-matching");
  });
});
