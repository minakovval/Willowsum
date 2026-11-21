import { describe, expect, it } from "vitest";
import { flagOn, flagsOn } from "../application/runtime.ts";
import type { FlagSnapshot } from "../application/ports.ts";
import { FLAGS } from "./catalogue.ts";

/**
 * FLW-38@PoC (S-135): `GET /v1/budget/periods/{period}/summary` answers the budget's sums and keeps the budget's
 * period snapshot, so with the budget (`budget.period`) switched off for a space «Підсумок періоду» is off too — on the
 * route and in GET /v1/me/features (both evaluate `flagOn`).
 */
const snap = (on: readonly string[]): FlagSnapshot => ({
  rollouts: new Map(on.map((k) => [k, { stage: "all" as const }])),
  killed: new Set(),
  fullyEnabledAt: new Map(),
});
const never = async () => false;

describe("FLW-38@PoC FR 1: the flag of «Підсумок періоду» follows the budget's flag", () => {
  it("FLW-38@PoC FR 1: budget.summary is a release flag that requires budget.period", () => {
    expect(FLAGS["budget.summary"]).toMatchObject({ kind: "release", requires: "budget.period" });
  });

  it("FLW-38@PoC FR 1: off for a space while the budget is off, on only when both are on; off by default", async () => {
    expect(await flagOn(snap([]), "budget.summary", "h", never)).toBe(false);
    expect(await flagOn(snap(["budget.summary"]), "budget.summary", "h", never)).toBe(false);
    expect(await flagOn(snap(["budget.period"]), "budget.summary", "h", never)).toBe(false);
    expect(await flagOn(snap(["budget.summary", "budget.period"]), "budget.summary", "h", never)).toBe(true);
    // GET /v1/me/features lists it by the same rule: never while the budget is hidden.
    expect(await flagsOn(snap(["budget.summary"]), "h", never)).not.toContain("budget.summary");
    expect(await flagsOn(snap(["budget.summary", "budget.period"]), "h", never)).toContain("budget.summary");
  });
});
