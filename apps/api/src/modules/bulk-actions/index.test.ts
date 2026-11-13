import { describe, expect, it } from "vitest";
import { bulkActionsModule } from "./index.ts";

describe("bulk-actions module", () => {
  it("declares its public interface", () => {
    expect(bulkActionsModule.name).toBe("bulk-actions");
  });
});
