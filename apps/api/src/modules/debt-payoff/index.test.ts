import { describe, expect, it } from "vitest";
import { debtPayoffModule } from "./index.ts";

describe("debt-payoff module", () => {
  it("declares its public interface", () => {
    expect(debtPayoffModule.name).toBe("debt-payoff");
  });
});
