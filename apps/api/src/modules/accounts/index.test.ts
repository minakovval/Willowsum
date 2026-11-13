import { describe, expect, it } from "vitest";
import { accountsModule } from "./index.ts";

describe("accounts module", () => {
  it("declares its public interface", () => {
    expect(accountsModule.name).toBe("accounts");
  });
});
