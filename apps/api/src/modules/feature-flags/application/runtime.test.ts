import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkFlagsReady,
  createFlagRuntime,
  flagOn,
  flagsOn,
  flagsReadiness,
  KILL_SWITCH_MAX_DELAY_MS,
  LOAD_WAIT_MS,
  REFRESH_MS,
} from "./index.ts";
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

describe("CICD-06 AC3: the ≤ 1 minute bound holds when reloads fail, hang or are slow (fake timers)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The memory store, with loads that can be held open. */
  function slowStore() {
    const store = memoryFlagStore();
    const load = store.snapshot.bind(store);
    const held: (() => void)[] = [];
    let hold = false;
    store.snapshot = async () => {
      if (hold) await new Promise<void>((resolve) => held.push(resolve));
      return load();
    };
    return {
      store,
      hold: (on: boolean) => {
        hold = on;
      },
      release: () => held.splice(0).forEach((r) => r()),
    };
  }

  it("a hanging reload: requests wait at most LOAD_WAIT_MS; the old state answers until it is 60 s old, then every module is unavailable and the runtime is not fresh", async () => {
    vi.useFakeTimers({ now: 0 });
    const { store, hold } = slowStore();
    const runtime = createFlagRuntime(store);
    expect(await runtime.isModuleAvailable("audit")).toBe(true);
    hold(true);
    vi.setSystemTime(REFRESH_MS);
    const answer = runtime.isModuleAvailable("audit");
    await vi.advanceTimersByTimeAsync(LOAD_WAIT_MS);
    expect(await answer).toBe(true);
    expect(runtime.fresh).toBe(true);
    vi.setSystemTime(KILL_SWITCH_MAX_DELAY_MS - 1);
    expect(runtime.fresh).toBe(true);
    vi.setSystemTime(KILL_SWITCH_MAX_DELAY_MS);
    const late = runtime.isModuleAvailable("audit");
    await vi.advanceTimersByTimeAsync(LOAD_WAIT_MS);
    expect(await late).toBe(false);
    expect(
      await Promise.race([
        runtime.isEnabled("3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01", "household.core"),
        vi.advanceTimersByTimeAsync(LOAD_WAIT_MS).then(() => "waited"),
      ]),
    ).toBe(false);
    expect(runtime.fresh).toBe(false);
    expect(runtime.loaded).toBe(true);
  });

  it("failing reloads: after 60 s without a successful load every module is unavailable; the next success restores it", async () => {
    vi.useFakeTimers({ now: 0 });
    const store = memoryFlagStore();
    const runtime = createFlagRuntime(store);
    expect(await runtime.isModuleAvailable("audit")).toBe(true);
    store.fail = true;
    vi.setSystemTime(30_000);
    expect(await runtime.isModuleAvailable("audit")).toBe(true);
    vi.setSystemTime(60_000);
    expect(await runtime.isModuleAvailable("audit")).toBe(false);
    store.fail = false;
    vi.setSystemTime(61_000);
    expect(await runtime.isModuleAvailable("audit")).toBe(true);
    expect(runtime.fresh).toBe(true);
  });

  it("the 15 s count from the start of a load, so a slow load does not stretch them", async () => {
    vi.useFakeTimers({ now: 0 });
    const { store, hold, release } = slowStore();
    const runtime = createFlagRuntime(store);
    hold(true);
    const first = runtime.isModuleAvailable("access-scope");
    // The load started at 0 s and finishes at 10 s.
    await vi.advanceTimersByTimeAsync(LOAD_WAIT_MS);
    expect(await first).toBe(false);
    vi.setSystemTime(10_000);
    hold(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(await runtime.isModuleAvailable("access-scope")).toBe(true);
    // A kill switch stored right after the load started is in force 15 s after that start, not 15 s after its end.
    await store.setKillSwitch("access-scope", true);
    vi.setSystemTime(REFRESH_MS);
    expect(await runtime.isModuleAvailable("access-scope")).toBe(false);
  });
});

describe("CICD-06 / ADR-0004: readiness of the api role follows the freshness of the flags (fake timers)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the decision: fresh → ok; never loaded → flags-not-loaded; loaded but stale → flags-stale", () => {
    expect(flagsReadiness({ loaded: true, fresh: true })).toBe("ok");
    expect(flagsReadiness({ loaded: false, fresh: false })).toBe("flags-not-loaded");
    expect(flagsReadiness({ loaded: true, fresh: false })).toBe("flags-stale");
  });

  // Mutants: readiness on `loaded` instead of `fresh` (stale says ok); always «flags-not-loaded» (stale and
  // recovery say the wrong thing).
  it("on a real runtime: not loaded → loaded → 60 s of failed reloads → stale → a success → ok again", async () => {
    vi.useFakeTimers({ now: 0 });
    const store = memoryFlagStore();
    const runtime = createFlagRuntime(store);
    store.fail = true;
    expect(await checkFlagsReady(runtime)).toBe("flags-not-loaded");
    store.fail = false;
    expect(await checkFlagsReady(runtime)).toBe("ok");
    store.fail = true;
    vi.setSystemTime(KILL_SWITCH_MAX_DELAY_MS - 1);
    expect(await checkFlagsReady(runtime)).toBe("ok");
    vi.setSystemTime(KILL_SWITCH_MAX_DELAY_MS);
    expect(await checkFlagsReady(runtime)).toBe("flags-stale");
    expect(await runtime.isModuleAvailable("audit")).toBe(false);
    store.fail = false;
    expect(await checkFlagsReady(runtime)).toBe("ok");
    expect(await runtime.isModuleAvailable("audit")).toBe(true);
  });

  it("a fresh runtime is not reloaded by the probe", async () => {
    const store = memoryFlagStore();
    const runtime = createFlagRuntime(store);
    await checkFlagsReady(runtime);
    await checkFlagsReady(runtime);
    expect(store.calls.snapshot).toBe(1);
  });
});

describe("CICD-06: a sub-function's flag is on only while the flag it requires is on", () => {
  const catalogue = {
    "x.core": { kind: "operational" },
    "x.core.export": { kind: "release", requires: "x.core" },
    "x.core.export.pdf": { kind: "release", requires: "x.core.export" },
  };
  const snap = (on: string[]) => ({
    rollouts: new Map(on.map((k) => [k, { stage: "all" as const }])),
    killed: new Set<string>(),
    fullyEnabledAt: new Map(),
  });

  it.each([
    [
      ["x.core", "x.core.export", "x.core.export.pdf"],
      ["x.core", "x.core.export", "x.core.export.pdf"],
    ],
    [["x.core.export", "x.core.export.pdf"], []],
    [["x.core", "x.core.export.pdf"], ["x.core"]],
    [
      ["x.core", "x.core.export"],
      ["x.core", "x.core.export"],
    ],
  ])("on %j → listed %j", async (on, listed) => {
    expect(await flagsOn(snap(on), h, async () => false, catalogue)).toEqual(listed);
  });

  it("flagOn applies the same rule", async () => {
    expect(await flagOn(snap(["x.core.export"]), "x.core.export", h, async () => false, catalogue)).toBe(
      false,
    );
    expect(
      await flagOn(snap(["x.core", "x.core.export"]), "x.core.export", h, async () => false, catalogue),
    ).toBe(true);
  });
});

describe("CICD-06: the test-space lookup waits no longer than LOAD_WAIT_MS (fake timers)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a hanging lookup counts as «not a test space» after 2 s (fail closed), is not cached, and a later answer is used", async () => {
    vi.useFakeTimers({ now: 0 });
    const store = memoryFlagStore();
    await store.setRollout("household.core", { stage: "test" });
    store.testHouseholds.add(h);
    const real = store.isTestHousehold.bind(store);
    store.isTestHousehold = () => new Promise(() => undefined);
    const runtime = createFlagRuntime(store);
    let answer: boolean | undefined;
    void runtime.isEnabled(h, "household.core").then((a) => (answer = a));
    await vi.advanceTimersByTimeAsync(LOAD_WAIT_MS - 1);
    expect(answer).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toBe(false);
    store.isTestHousehold = real;
    expect(await runtime.isEnabled(h, "household.core")).toBe(true);
  });
});

describe("CICD-06: a failed test-space lookup keeps the function hidden (404, not 500)", () => {
  it("a rejected lookup counts as «not a test space», is not cached, and the next request asks again", async () => {
    const store = memoryFlagStore();
    await store.setRollout("household.core", { stage: "test" });
    store.testHouseholds.add(h);
    const runtime = createFlagRuntime(store, { now: () => 1_000_000 });
    const real = store.isTestHousehold.bind(store);
    let asked = 0;
    store.isTestHousehold = async () => {
      asked++;
      throw new Error("database unreachable");
    };
    expect(await runtime.isEnabled(h, "household.core")).toBe(false);
    expect(await runtime.enabledFlags(h)).toEqual([]);
    expect(asked).toBe(2);
    store.isTestHousehold = real;
    expect(await runtime.isEnabled(h, "household.core")).toBe(true);
  });
});
