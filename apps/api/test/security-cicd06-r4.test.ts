import { describe, expect, it, vi } from "vitest";
import type * as Catalogue from "../src/modules/feature-flags/domain/catalogue.ts";
import type * as PlanCatalog from "../src/modules/plan-catalog/index.ts";

/**
 * Security review of PR #83 (follow-up to #82) at 6ce7f5a: the parent-flag rule in the real wiring, the
 * depth bound shared by check:flags and the runtime, and a failed test-space lookup. Each test kills a mutant
 * the PR's tests let through, named in the test. The catalogue gets a sub-function flag here (the shipped one
 * has none yet).
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
  return { ...real, FLAGS, FLAG_KEYS: Object.keys(FLAGS), isFlagKey: (k: string) => Object.hasOwn(FLAGS, k) };
});

// The function of the sub-flag in the feature catalogue too (ARC-01 FR 7: every flag is a function).
vi.mock("../src/modules/plan-catalog/index.ts", async (importOriginal) => {
  const real = await importOriginal<typeof PlanCatalog>();
  return { ...real, FEATURE_KEYS: [...real.FEATURE_KEYS, "household.core.export"] };
});

const { apiOptions } = await import("../src/api.ts");
const { createFlagRuntime, flagOn } = await import("../src/modules/feature-flags/application/index.ts");
const { memoryFlagStore } =
  await import("../src/modules/feature-flags/application/memory-store.test-helper.ts");
const { flagReviewProblems, MAX_REQUIRES_DEPTH } =
  await import("../src/modules/feature-flags/domain/index.ts");
const { testWiring } = await import("./http.ts");

const h = "3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01";

describe("CICD-06: the real wiring hands the catalogue's «requires» to the route check", () => {
  // Mutant: apiOptions' flagRequires always undefined — every sub-function route would be refused, or (with
  // the check weakened alongside) a route's own flag could require something other than its feature.
  it("flagRequires answers the parent of a sub-function flag", () => {
    expect(apiOptions(testWiring()).flagRequires("household.core.export")).toBe("household.core");
  });
});

describe("CICD-06: check:flags and the runtime agree on how deep «requires» may chain", () => {
  const chain = (hops: number) => {
    const keys = Array.from({ length: hops + 1 }, (_, i) => `a.f${i}`);
    const catalogue: Record<string, { kind: string; requires?: string }> = {};
    keys.forEach((k, i) => (catalogue[k] = { kind: "release", ...(i > 0 ? { requires: keys[i - 1] } : {}) }));
    return { keys, catalogue, last: keys.at(-1)! };
  };
  const allOn = (keys: string[]) => ({
    rollouts: new Map(keys.map((k) => [k, { stage: "all" as const }])),
    killed: new Set<string>(),
    fullyEnabledAt: new Map<string, Date>(),
  });

  // Mutant: the runtime bound `depth >= MAX` — a chain check:flags accepts would throw on every request.
  it(`a chain of ${MAX_REQUIRES_DEPTH} hops passes check:flags and evaluates; ${MAX_REQUIRES_DEPTH + 1} hops is refused by both`, async () => {
    const ok = chain(MAX_REQUIRES_DEPTH);
    const definitions = Object.fromEntries(
      ok.keys.map((k) => [
        k,
        {
          kind: "release",
          owner: "product-owner",
          reviewBy: "2099-01-01",
          description: "x",
          ...ok.catalogue[k],
        },
      ]),
    );
    expect(flagReviewProblems(definitions, "2026-11-06", ok.keys)).toEqual([]);
    expect(await flagOn(allOn(ok.keys), ok.last, h, async () => false, ok.catalogue)).toBe(true);

    const deep = chain(MAX_REQUIRES_DEPTH + 1);
    await expect(flagOn(allOn(deep.keys), deep.last, h, async () => false, deep.catalogue)).rejects.toThrow(
      /too deep/,
    );
  });
});

describe("CICD-06: a failed test-space lookup is not remembered", () => {
  // Mutant: a rejected lookup stays in the cache — every request until the next reload fails the same way.
  it("after a lookup error the next request asks the store again", async () => {
    const store = memoryFlagStore();
    await store.setRollout("household.core", { stage: "test" });
    store.testHouseholds.add(h);
    const runtime = createFlagRuntime(store, { now: () => 1_000_000 });
    const real = store.isTestHousehold.bind(store);
    store.isTestHousehold = async () => {
      throw new Error("database unreachable");
    };
    // Coordinator's item 2 on #83: a failed lookup counts as «not a test space» (hidden, 404), not an error.
    await expect(runtime.isEnabled(h, "household.core")).resolves.toBe(false);
    store.isTestHousehold = real;
    expect(await runtime.isEnabled(h, "household.core")).toBe(true);
  });
});
