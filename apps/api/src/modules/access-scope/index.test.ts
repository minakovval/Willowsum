import { describe, expect, it } from "vitest";
import { accessScopeModule, checkPermission } from "./index.ts";

describe("access-scope module", () => {
  it("declares its public interface and its API route", () => {
    expect(accessScopeModule.name).toBe("access-scope");
    expect(accessScopeModule.routes?.map((r) => r.operationId)).toEqual(["getMyPermissions"]);
  });

  it("checkPermission is the matrix check", () => {
    expect(checkPermission({ role: "viewer", scoped: false }, "household.data.write")).toBe(false);
    expect(checkPermission({ role: "editor", scoped: false }, "household.data.write")).toBe(true);
  });
});
