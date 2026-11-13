import { describe, expect, it } from "vitest";
import { cashflowModule } from "./index.ts";

describe("cashflow module", () => {
  it("declares its public interface", () => {
    expect(cashflowModule.name).toBe("cashflow");
  });
});
