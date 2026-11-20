import { describe, expect, it } from "vitest";
import { flagOn, flagsOn } from "../application/runtime.ts";
import type { FlagSnapshot } from "../application/ports.ts";
import { FLAGS } from "./catalogue.ts";

/**
 * Security review of #641: `GET /v1/budget/periods/{period}/spendable` answers the budget's sums and keeps the budget's
 * period snapshot, so with the budget (`budget.period`) switched off for a space «Можна витратити» is off too — on the
 * route and in GET /v1/me/features (both evaluate `flagOn`).
 */
const snap = (on: readonly string[]): FlagSnapshot => ({
  rollouts: new Map(on.map((k) => [k, { stage: "all" as const }])),
  killed: new Set(),
  fullyEnabledAt: new Map(),
});
const never = async () => false;

describe("BUD-03@PoC «Права доступу»: the flag of «Можна витратити» follows the budget's flag", () => {
  it("BUD-03@PoC «Права доступу»: budget.spendable is a release flag that requires budget.period", () => {
    expect(FLAGS["budget.spendable"]).toMatchObject({ kind: "release", requires: "budget.period" });
  });

  it("BUD-03@PoC «Права доступу»: off for a space while the budget is off, on only when both are on; off by default", async () => {
    expect(await flagOn(snap([]), "budget.spendable", "h", never)).toBe(false);
    expect(await flagOn(snap(["budget.spendable"]), "budget.spendable", "h", never)).toBe(false);
    expect(await flagOn(snap(["budget.period"]), "budget.spendable", "h", never)).toBe(false);
    expect(await flagOn(snap(["budget.spendable", "budget.period"]), "budget.spendable", "h", never)).toBe(
      true,
    );
    // GET /v1/me/features lists it by the same rule: never while the budget is hidden.
    expect(await flagsOn(snap(["budget.spendable"]), "h", never)).not.toContain("budget.spendable");
    expect(await flagsOn(snap(["budget.spendable", "budget.period"]), "h", never)).toContain(
      "budget.spendable",
    );
  });
});
