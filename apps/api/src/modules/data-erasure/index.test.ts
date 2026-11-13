import { describe, expect, it } from "vitest";
import { dataErasureModule } from "./index.ts";

describe("data-erasure module", () => {
  it("declares its public interface", () => {
    expect(dataErasureModule.name).toBe("data-erasure");
  });
});
