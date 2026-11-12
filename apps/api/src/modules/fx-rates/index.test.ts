import { describe, expect, it } from "vitest";
import { fxRatesModule } from "./index.ts";

describe("fx-rates module", () => {
  it("declares its public interface", () => {
    expect(fxRatesModule.name).toBe("fx-rates");
  });
});
