import { describe, expect, it } from "vitest";
import { importSessionsModule } from "./index.ts";

describe("import-sessions module", () => {
  it("declares its public interface", () => {
    expect(importSessionsModule.name).toBe("import-sessions");
  });
});
