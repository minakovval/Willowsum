import { describe, expect, it } from "vitest";
import { flagOn } from "../application/runtime.ts";
import type { FlagSnapshot } from "../application/ports.ts";
import { FLAGS } from "./catalogue.ts";

/**
 * #603 N1 (security review of #600): `GET /v1/budget/trend` answers the budget's plan and writes the budget's period
 * snapshots, so with the budget (`budget.period`) switched off for a space the trend is off too.
 */
const snap = (on: readonly string[]): FlagSnapshot => ({
  rollouts: new Map(on.map((k) => [k, { stage: "all" as const }])),
  killed: new Set(),
  fullyEnabledAt: new Map(),
});
const never = async () => false;

describe("BUD-16@PoC «Права доступу»: the trend's flag follows the budget's flag", () => {
  it("BUD-16@PoC «Права доступу»: budget.trend requires budget.period", () => {
    expect((FLAGS["budget.trend"] as { requires?: string }).requires).toBe("budget.period");
  });

  it("BUD-16@PoC «Права доступу»: the trend is off for a space while the budget is off, on when both are on", async () => {
    expect(await flagOn(snap(["budget.trend"]), "budget.trend", "h", never)).toBe(false);
    expect(await flagOn(snap(["budget.trend", "budget.period"]), "budget.trend", "h", never)).toBe(true);
  });
});
