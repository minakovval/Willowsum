import { describe, expect, it } from "vitest";
import { parseFlagCommand, rolloutReminder } from "./flags-cli.ts";

const staff = "1e2d3c4b-5a69-4788-9a6b-5c4d3e2f1a07";
const space = "3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01";

describe("CICD-06: scripts/flags.ts — staff change flags, kill switches and test spaces through FlagAdmin", () => {
  it("parses each command; changes carry the staff actor", () => {
    expect(parseFlagCommand(["state"])).toEqual({ kind: "state" });
    expect(parseFlagCommand(["rollout", "household.core", "share:10", "--actor", staff])).toEqual({
      kind: "rollout",
      key: "household.core",
      rollout: { stage: "share", percent: 10 },
      actor: { kind: "staff", id: staff },
    });
    expect(parseFlagCommand(["--actor", staff, "kill", "access-scope"])).toMatchObject({
      kind: "kill-switch",
      module: "access-scope",
      disabled: true,
    });
    expect(parseFlagCommand(["revive", "access-scope", "--actor", staff])).toMatchObject({ disabled: false });
    expect(parseFlagCommand(["test-space", space, "on", "--actor", staff])).toMatchObject({ isTest: true });
  });

  it("refuses a change without an actor, a bad stage and unknown commands", () => {
    expect(() => parseFlagCommand(["kill", "access-scope"])).toThrow(/--actor/);
    expect(() => parseFlagCommand(["rollout", "x", "share:0", "--actor", staff])).toThrow(/rollout/);
    expect(() => parseFlagCommand(["rollout", "x", "half", "--actor", staff])).toThrow(/rollout/);
    expect(() => parseFlagCommand(["kill", "a", "--actor", "anna"])).toThrow(/UUID/);
    expect(() => parseFlagCommand(["drop"])).toThrow(/unknown command/);
  });
});

describe("CICD-06 FR 2: rollout of a release flag to «all» reminds to record fullyEnabledOn", () => {
  const flags = {
    "x.new": { kind: "release" as const, owner: "product-owner", reviewBy: "2027-01-01", description: "x" },
    "x.core": {
      kind: "operational" as const,
      owner: "product-owner",
      reviewBy: "2027-01-01",
      description: "x",
    },
  };
  it("prints the day to write and the 30-day limit", () => {
    expect(rolloutReminder("x.new", { stage: "all" }, flags, "2026-11-06")).toMatch(
      /x\.new.*fullyEnabledOn: "2026-11-06".*within 30 days/,
    );
  });
  it("says nothing for other stages and for operational flags", () => {
    expect(rolloutReminder("x.new", { stage: "share", percent: 50 }, flags, "2026-11-06")).toBeNull();
    expect(rolloutReminder("x.core", { stage: "all" }, flags, "2026-11-06")).toBeNull();
  });
});
