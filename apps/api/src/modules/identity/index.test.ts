import { describe, expect, it } from "vitest";
import { identityModule } from "./index.ts";

describe("identity module", () => {
  it("declares its public interface", () => {
    expect(identityModule.name).toBe("identity");
  });
});
