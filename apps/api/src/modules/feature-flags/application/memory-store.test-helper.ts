// Test helper (not part of the module's interface): an in-memory FlagStore with the semantics of the table one.
import type { Rollout } from "../domain/index.ts";
import type { FlagSnapshot, FlagStore } from "./ports.ts";

export function memoryFlagStore(): FlagStore & {
  calls: { snapshot: number; test: number };
  fail: boolean;
  testHouseholds: Set<string>;
} {
  const rollouts = new Map<string, Rollout>();
  const ids = new Map<string, string>();
  const fullyEnabledAt = new Map<string, Date>();
  const killed = new Set<string>();
  const testHouseholds = new Set<string>();
  const calls = { snapshot: 0, test: 0 };
  let n = 0;
  const idOf = (k: string) => {
    if (!ids.has(k)) ids.set(k, `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
    return ids.get(k)!;
  };
  const store = {
    calls,
    fail: false,
    testHouseholds,
    snapshot: async (): Promise<FlagSnapshot> => {
      calls.snapshot++;
      if (store.fail) throw new Error("database unreachable");
      return {
        rollouts: new Map(rollouts),
        killed: new Set(killed),
        fullyEnabledAt: new Map(fullyEnabledAt),
      };
    },
    isTestHousehold: async (h: string) => {
      calls.test++;
      return testHouseholds.has(h);
    },
    setRollout: async (key: string, next: Rollout) => {
      const before = rollouts.get(key) ?? { stage: "off" as const };
      rollouts.set(key, next);
      if (next.stage !== "all") fullyEnabledAt.delete(key);
      else if (before.stage !== "all") fullyEnabledAt.set(key, new Date());
      return { id: idOf(`flag:${key}`), before };
    },
    setKillSwitch: async (module: string, disabled: boolean) => {
      const before = killed.has(module);
      if (disabled) killed.add(module);
      else killed.delete(module);
      return { id: idOf(`module:${module}`), before };
    },
    setTestHousehold: async (h: string, isTest: boolean) => {
      const before = testHouseholds.has(h);
      if (isTest) testHouseholds.add(h);
      else testHouseholds.delete(h);
      return { before };
    },
  };
  return store;
}
