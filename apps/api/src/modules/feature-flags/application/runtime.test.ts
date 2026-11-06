import { describe, expect, it } from "vitest";
import { createFlagRuntime, KILL_SWITCH_MAX_DELAY_MS, REFRESH_MS } from "./index.ts";
import { memoryFlagStore } from "./memory-store.test-helper.ts";

const h = "3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("CICD-06 AC3: a kill switch takes effect in ≤ 1 minute without a release", () => {
  it("the refresh period is within the bound, and a longer one is refused", () => {
    expect(REFRESH_MS).toBeLessThanOrEqual(KILL_SWITCH_MAX_DELAY_MS);
    expect(KILL_SWITCH_MAX_DELAY_MS).toBe(60_000);
    expect(() => createFlagRuntime(memoryFlagStore(), { refreshMs: 61_000 })).toThrow(/60 s/);
  });

  it("a kill switch set in the store is in force for every request at most REFRESH_MS later, and so is switching back", async () => {
    const store = memoryFlagStore();
    const c = clock();
    const runtime = createFlagRuntime(store, { now: c.now });
    expect(await runtime.isModuleAvailable("access-scope")).toBe(true);
    await store.setKillSwitch("access-scope", true);
    c.advance(REFRESH_MS);
    expect(await runtime.isModuleAvailable("access-scope")).toBe(false);
    expect(await runtime.isModuleAvailable("audit")).toBe(true);
    await store.setKillSwitch("access-scope", false);
    c.advance(REFRESH_MS);
    expect(await runtime.isModuleAvailable("access-scope")).toBe(true);
  });

  it("between refreshes the cached state answers (one load per period, concurrent requests share it)", async () => {
    const store = memoryFlagStore();
    const c = clock();
    const runtime = createFlagRuntime(store, { now: c.now });
    await Promise.all(Array.from({ length: 20 }, () => runtime.isModuleAvailable("audit")));
    c.advance(REFRESH_MS - 1);
    await runtime.isModuleAvailable("audit");
    expect(store.calls.snapshot).toBe(1);
    c.advance(1);
    await runtime.isModuleAvailable("audit");
    expect(store.calls.snapshot).toBe(2);
  });

  it("before the state was ever loaded every module is unavailable and every flag off; a failed reload keeps the last state", async () => {
    const store = memoryFlagStore();
    const c = clock();
    const runtime = createFlagRuntime(store, { now: c.now });
    store.fail = true;
    expect(await runtime.isModuleAvailable("audit")).toBe(false);
    expect(await runtime.isEnabled(h, "household.core")).toBe(false);
    expect(runtime.loaded).toBe(false);
    store.fail = false;
    await store.setRollout("household.core", { stage: "all" });
    c.advance(1);
    expect(await runtime.isEnabled(h, "household.core")).toBe(true);
    expect(runtime.loaded).toBe(true);
    store.fail = true;
    c.advance(REFRESH_MS);
    expect(await runtime.isEnabled(h, "household.core")).toBe(true);
    expect(await runtime.isModuleAvailable("audit")).toBe(true);
  });
});

describe("CICD-06 AC1: the runtime follows the staged rollout", () => {
  it("a flag without stored state is off; test spaces are asked only when the stage needs it, and cached until the next refresh", async () => {
    const store = memoryFlagStore();
    const c = clock();
    const runtime = createFlagRuntime(store, { now: c.now });
    expect(await runtime.isEnabled(h, "household.core")).toBe(false);
    expect(await runtime.enabledFlags(h)).toEqual([]);
    expect(store.calls.test).toBe(0);
    await store.setRollout("household.core", { stage: "test" });
    store.testHouseholds.add(h);
    c.advance(REFRESH_MS);
    expect(await runtime.isEnabled(h, "household.core")).toBe(true);
    expect(await runtime.isEnabled(h, "household.core")).toBe(true);
    expect(await runtime.enabledFlags(h)).toEqual(["household.core"]);
    expect(store.calls.test).toBe(1);
    store.testHouseholds.delete(h);
    c.advance(REFRESH_MS);
    expect(await runtime.isEnabled(h, "household.core")).toBe(false);
  });

  it("an unknown flag is a programming error, not a silent «off»", async () => {
    await expect(createFlagRuntime(memoryFlagStore()).isEnabled(h, "nope")).rejects.toThrow(/Unknown flag/);
  });
});
