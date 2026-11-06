import { describe, expect, it, vi } from "vitest";
import type * as Catalogue from "../src/modules/feature-flags/domain/catalogue.ts";

/**
 * Security review, round 3 (PR #82 at fafa3f9): the `requires` chain as the API's flag check sees it. Each test
 * kills a mutant the PR's tests let through, named in the test. The catalogue gets a sub-function flag here
 * (the shipped one has none yet), so the runtime's own isEnabled is exercised, not only flagOn with a catalogue.
 */
vi.mock("../src/modules/feature-flags/domain/catalogue.ts", async (importOriginal) => {
  const real = await importOriginal<typeof Catalogue>();
  const FLAGS = {
    ...real.FLAGS,
    "household.core.export": {
      kind: "release",
      owner: "product-owner",
      reviewBy: "2099-01-01",
      requires: "household.core",
      description: "A sub-function of household.core (review fixture)",
    },
  };
  return {
    ...real,
    FLAGS,
    FLAG_KEYS: Object.keys(FLAGS),
    isFlagKey: (k: string) => Object.hasOwn(FLAGS, k),
  };
});

const { createFlagRuntime, flagOn } = await import("../src/modules/feature-flags/application/index.ts");
const { memoryFlagStore } =
  await import("../src/modules/feature-flags/application/memory-store.test-helper.ts");

const h = "3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01";

describe("CICD-06: the API's flag check (isEnabled) follows «requires»", () => {
  // Mutant: isEnabled evaluates only the flag itself (isOnFor) — a route whose own flag (or feature key)
  // requires a parent would be served while the parent function is off.
  it("a sub-function flag that is on is still off for the API while the flag it requires is off", async () => {
    const store = memoryFlagStore();
    const runtime = createFlagRuntime(store, { now: () => 1_000_000 });
    await store.setRollout("household.core.export", { stage: "all" });
    expect(await runtime.isEnabled(h, "household.core.export")).toBe(false);
    expect(await runtime.enabledFlags(h)).toEqual([]);
    await store.setRollout("household.core", { stage: "all" });
    await runtime.refresh();
    expect(await runtime.isEnabled(h, "household.core.export")).toBe(true);
    expect(await runtime.enabledFlags(h)).toEqual(["household.core", "household.core.export"]);
  });
});

describe("CICD-06: a broken «requires» chain never turns a flag on", () => {
  const snap = (on: string[]) => ({
    rollouts: new Map(on.map((k) => [k, { stage: "all" as const }])),
    killed: new Set<string>(),
    fullyEnabledAt: new Map<string, Date>(),
  });

  // Mutant: the depth bound removed — a cycle that slipped past check:flags would loop forever on a request.
  it("a cycle ends with an error, not an endless loop, even when every flag in it is on", async () => {
    const cyclic = {
      "a.one": { kind: "release", requires: "a.two" },
      "a.two": { kind: "release", requires: "a.one" },
    };
    const atTest = {
      rollouts: new Map([
        ["a.one", { stage: "test" as const }],
        ["a.two", { stage: "test" as const }],
      ]),
      killed: new Set<string>(),
      fullyEnabledAt: new Map<string, Date>(),
    };
    // A test space whose answer arrives on a later tick, so a runaway loop fails on the test timeout, not hangs.
    const later = () => new Promise<boolean>((resolve) => setImmediate(() => resolve(true)));
    await expect(flagOn(atTest, "a.one", h, later, cyclic)).rejects.toThrow(/too deep/);
  });

  // Mutant: an unknown parent counts as «off» silently — a catalogue mistake must be loud.
  it("a parent that is not in the catalogue is a programming error", async () => {
    await expect(
      flagOn(snap(["a.one"]), "a.one", h, async () => false, {
        "a.one": { kind: "release", requires: "a.gone" },
      }),
    ).rejects.toThrow(/Unknown flag a\.gone/);
  });
});
