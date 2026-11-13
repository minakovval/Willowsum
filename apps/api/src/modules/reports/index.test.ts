import { describe, expect, it } from "vitest";
import { reportsModule } from "./index.ts";

describe("reports module", () => {
  it("declares its public interface", () => {
    expect(reportsModule.name).toBe("reports");
  });
});
