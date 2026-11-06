import { describe, expect, it, vi } from "vitest";
import { AUDIT_ENTITY, createFlagAdmin } from "./index.ts";
import { memoryFlagStore } from "./memory-store.test-helper.ts";

const staff = { kind: "staff" as const, id: "1e2d3c4b-5a69-4788-9a6b-5c4d3e2f1a07" };
const h = "3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01";

function setup() {
  const store = memoryFlagStore();
  const audit = {
    record: vi.fn(async () => ({}) as never),
    recordPlatform: vi.fn(async () => ({}) as never),
  };
  const admin = createFlagAdmin({ store, audit, modules: ["access-scope", "feature-flags"] });
  return { store, audit, admin };
}

describe("CICD-06: flags change only through the internal interface, and every change is audited (П-10)", () => {
  it("a rollout change writes a platform audit entry with stage and share before and after", async () => {
    const { admin, audit } = setup();
    expect(await admin.setRollout(staff, "household.core", { stage: "share", percent: 20 })).toEqual({
      before: { stage: "off" },
      after: { stage: "share", percent: 20 },
    });
    expect(audit.recordPlatform).toHaveBeenCalledWith({
      actor: staff,
      channel: "system",
      entity: { type: AUDIT_ENTITY.flag, id: expect.any(String) },
      action: "update",
      changes: [
        { field: "flag", before: "household.core", after: "household.core", sensitive: false },
        { field: "stage", before: "off", after: "share", sensitive: false },
        { field: "percent", before: "0", after: "20", sensitive: false },
      ],
    });
  });

  it("a kill switch change is audited on the platform log; a test-space mark in that space's own log", async () => {
    const { admin, audit } = setup();
    await admin.setKillSwitch({ kind: "system" }, "access-scope", true);
    expect(audit.recordPlatform).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actor: { kind: "system" },
        entity: { type: AUDIT_ENTITY.killSwitch, id: expect.any(String) },
        changes: [
          { field: "module", before: "access-scope", after: "access-scope", sensitive: false },
          { field: "disabled", before: "false", after: "true", sensitive: false },
        ],
      }),
    );
    await admin.setTestHousehold(staff, h, true);
    expect(audit.record).toHaveBeenCalledWith(
      h,
      expect.objectContaining({
        entity: { type: AUDIT_ENTITY.testHousehold, id: h },
        changes: [{ field: "testHousehold", before: "false", after: "true", sensitive: false }],
      }),
    );
  });

  it("a change that changes nothing writes nothing", async () => {
    const { admin, audit } = setup();
    await admin.setRollout(staff, "household.core", { stage: "off" });
    await admin.setKillSwitch(staff, "access-scope", false);
    await admin.setTestHousehold(staff, h, false);
    expect(audit.recordPlatform).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("unknown flags and modules, invalid rollouts and household users as authors are refused before any write", async () => {
    const { admin, audit, store } = setup();
    await expect(admin.setRollout(staff, "nope", { stage: "all" })).rejects.toThrow(/Unknown flag/);
    await expect(
      admin.setRollout(staff, "household.core", { stage: "share", percent: 100 }),
    ).rejects.toThrow();
    await expect(admin.setKillSwitch(staff, "billing", true)).rejects.toThrow(/Unknown module/);
    await expect(
      admin.setRollout({ kind: "user", id: staff.id } as never, "household.core", { stage: "all" }),
    ).rejects.toThrow();
    await expect(admin.setTestHousehold(staff, "not-a-uuid", true)).rejects.toThrow();
    expect(audit.recordPlatform).not.toHaveBeenCalled();
    expect((await store.snapshot()).rollouts.size).toBe(0);
  });
});
