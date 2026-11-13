import { describe, expect, it } from "vitest";
import { transactionsModule } from "./index.ts";

describe("transactions module", () => {
  it("declares its public interface", () => {
    expect(transactionsModule.name).toBe("transactions");
  });
});
