import { describe, expect, it } from "vitest";
import { ledgerModule } from "./index.ts";

describe("ledger module", () => {
  it("declares its public interface", () => {
    expect(ledgerModule.name).toBe("ledger");
  });
});
