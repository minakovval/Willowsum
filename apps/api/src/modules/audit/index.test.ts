import { describe, expect, it } from "vitest";
import { auditModule } from "./index.ts";

describe("audit module", () => {
  it("declares its public interface", () => {
    expect(auditModule.name).toBe("audit");
  });
});
