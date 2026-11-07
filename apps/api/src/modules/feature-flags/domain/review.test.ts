import { describe, expect, it } from "vitest";
import { FLAGS, flagReviewProblems, overdueFullRollouts } from "./index.ts";

const base = { owner: "product-owner", description: "A function" };

describe("CICD-06 AC2: every flag has an owner and a review date; CI fails for stale flags", () => {
  it("the flags of the code are valid today (the same check as pnpm check:flags)", () => {
    expect(flagReviewProblems(FLAGS, new Date().toISOString().slice(0, 10), Object.keys(FLAGS))).toEqual([]);
  });

  it("a flag without an owner or a review date fails", () => {
    const problems = flagReviewProblems(
      {
        "a.one": { kind: "release", description: "x" },
        "a.two": { ...base, kind: "release", reviewBy: "soon" },
      },
      "2026-11-06",
      ["a.one", "a.two"],
    );
    expect(problems).toEqual([
      expect.stringMatching(/^a\.one: invalid definition \(owner, reviewBy\)/),
      expect.stringMatching(/^a\.two: invalid definition \(reviewBy\)/),
    ]);
  });

  it("a flag past its review date fails; on the review day it still passes", () => {
    const flags = { "a.one": { ...base, kind: "operational", reviewBy: "2026-11-05" } };
    expect(flagReviewProblems(flags, "2026-11-05", ["a.one"])).toEqual([]);
    expect(flagReviewProblems(flags, "2026-11-06", ["a.one"])).toEqual([
      "a.one: review date 2026-11-05 has passed; the owner product-owner reviews it",
    ]);
  });

  it("a release flag fully enabled for more than 30 days fails (it must leave the code)", () => {
    const flags = {
      "a.one": { ...base, kind: "release", reviewBy: "2027-06-01", fullyEnabledOn: "2026-10-01" },
    };
    expect(flagReviewProblems(flags, "2026-10-31", ["a.one"])).toEqual([]);
    expect(flagReviewProblems(flags, "2026-11-01", ["a.one"])).toEqual([
      expect.stringMatching(/^a\.one: fully enabled since 2026-10-01 \(31 days\); remove the flag/),
    ]);
  });

  it("only release flags record a full rollout (an operational switch is permanent)", () => {
    const flags = {
      "a.one": { ...base, kind: "operational", reviewBy: "2027-06-01", fullyEnabledOn: "2026-10-01" },
    };
    expect(flagReviewProblems(flags, "2026-10-02", ["a.one"])).toEqual([
      expect.stringMatching(/^a\.one: invalid definition/),
    ]);
  });

  it("ARC-01 FR 7: every function of the feature catalogue has a flag, and no flag lacks its function", () => {
    const flags = { "a.one": { ...base, kind: "release", reviewBy: "2027-06-01" } };
    expect(flagReviewProblems(flags, "2026-11-06", ["a.one", "a.two"])).toEqual([
      "a.two: a function without a flag (ARC-01 FR 7); add it to FLAGS",
    ]);
    expect(flagReviewProblems(flags, "2026-11-06", [])).toEqual([
      "a.one: no such key in the feature catalogue (plan-catalog FEATURES)",
    ]);
  });

  it("on the stored state: release flags at «all» for more than 30 days are reported", () => {
    const flags = {
      "a.one": { ...base, kind: "release" as const, reviewBy: "2027-06-01" },
      "a.two": { ...base, kind: "operational" as const, reviewBy: "2027-06-01" },
    };
    const at = new Map([
      ["a.one", new Date("2026-10-01T23:00:00Z")],
      ["a.two", new Date("2026-01-01T00:00:00Z")],
    ]);
    expect(overdueFullRollouts(flags, at, new Date("2026-10-31T12:00:00Z"))).toEqual([]);
    expect(overdueFullRollouts(flags, at, new Date("2026-11-01T00:30:00Z"))).toEqual(["a.one"]);
  });

  it("a sub-function's flag requires an existing flag, without cycles", () => {
    const f = (requires?: string) => ({
      ...base,
      kind: "release",
      reviewBy: "2027-06-01",
      ...(requires ? { requires } : {}),
    });
    const keys = ["a.one", "a.two", "a.three"];
    expect(
      flagReviewProblems({ "a.one": f(), "a.two": f("a.one"), "a.three": f("a.two") }, "2026-11-06", keys),
    ).toEqual([]);
    expect(
      flagReviewProblems({ "a.one": f(), "a.two": f("a.nope"), "a.three": f() }, "2026-11-06", keys),
    ).toEqual(["a.two: requires a.nope, which is not a flag"]);
    expect(
      flagReviewProblems(
        { "a.one": f("a.two"), "a.two": f("a.one"), "a.three": f("a.three") },
        "2026-11-06",
        keys,
      ),
    ).toEqual([
      "a.one: requires a.two, which is a cycle",
      "a.two: requires a.one, which is a cycle",
      "a.three: requires a.three, which is a cycle",
    ]);
  });

  it("a «requires» chain longer than the bound is reported, so the walk always ends", () => {
    const chain: Record<string, unknown> = {};
    const keys = Array.from({ length: 12 }, (_, i) => `a.f${i}`);
    keys.forEach((k, i) =>
      Object.assign(chain, {
        [k]: {
          ...base,
          kind: "release",
          reviewBy: "2027-06-01",
          ...(i > 0 ? { requires: keys[i - 1] } : {}),
        },
      }),
    );
    const problems = flagReviewProblems(chain, "2026-11-06", keys);
    expect(problems).toContain("a.f11: requires chains deeper than 8 flags");
    expect(problems.filter((p) => /deeper/.test(p)).length).toBe(3);
  });
});
