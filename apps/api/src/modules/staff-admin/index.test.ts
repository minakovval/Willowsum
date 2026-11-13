import { describe, expect, it } from "vitest";
import { staffAdminModule } from "./index.ts";

describe("staff-admin module", () => {
  it("declares its public interface", () => {
    expect(staffAdminModule.name).toBe("staff-admin");
  });
});
