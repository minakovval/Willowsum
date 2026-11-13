import { describe, expect, it } from "vitest";
import { recurringModule } from "./index.ts";

describe("recurring module", () => {
  it("declares its public interface", () => {
    expect(recurringModule.name).toBe("recurring");
  });
});
