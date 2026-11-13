import { describe, expect, it } from "vitest";
import { merchantsModule } from "./index.ts";

describe("merchants module", () => {
  it("declares its public interface", () => {
    expect(merchantsModule.name).toBe("merchants");
  });
});
