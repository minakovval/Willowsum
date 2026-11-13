import { describe, expect, it } from "vitest";
import { goalsModule } from "./index.ts";

describe("goals module", () => {
  it("declares its public interface", () => {
    expect(goalsModule.name).toBe("goals");
  });
});
