import { describe, expect, it } from "vitest";
import { can, PERMISSION_KEYS, permissionsOf, SCOPABLE_ROLES } from "./permissions.ts";

describe("access-scope: one permission check for every module (00-general §0.3, П-5, П-24)", () => {
  it.each([
    ["owner", PERMISSION_KEYS],
    [
      "admin",
      PERMISSION_KEYS.filter(
        (p) =>
          ![
            "members.assign-privileged",
            "billing.manage",
            "household.transfer",
            "household.rename",
            "session.timeout.manage",
          ].includes(p),
      ),
    ],
    ["editor", ["household.data.read", "household.data.write", "assets.dispose", "bank.reconciliation.undo"]],
    ["viewer", ["household.data.read"]],
    ["advisor", ["household.data.read"]],
  ] as const)("%s holds exactly the matrix row permissions", (role, expected) => {
    expect(permissionsOf({ role, scoped: false })).toEqual(expected);
  });

  it.each(SCOPABLE_ROLES.map((r) => [r]))("a scoped %s only reads, whatever the role", (role) => {
    expect(permissionsOf({ role, scoped: true })).toEqual(["household.data.read"]);
  });

  it.each([["owner"], ["admin"]] as const)(
    "scope applies only to Editor, Viewer and Advisor: a «scoped %s» is impossible and holds nothing",
    (role) => {
      expect(SCOPABLE_ROLES).not.toContain(role);
      expect(permissionsOf({ role, scoped: true })).toEqual([]);
    },
  );

  it("an unknown role or permission holds nothing", () => {
    expect(can({ role: "root", scoped: false }, "household.data.read")).toBe(false);
    expect(can({ role: "owner", scoped: false }, "anything")).toBe(false);
    expect(can({ role: "owner", scoped: false }, "toString")).toBe(false);
  });
});
