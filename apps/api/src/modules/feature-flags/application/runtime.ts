import { FLAG_KEYS, isFlagKey, isOnFor, OFF, type FlagKey } from "../domain/index.ts";
import type { FlagSnapshot, FlagStore } from "./ports.ts";

/**
 * How old the cached state may get before a request reloads it. A kill switch or a rollout change made
 * through FlagAdmin reaches every API process within this time, without a release (CICD-06 FR 3: ≤ 1 min).
 */
export const REFRESH_MS = 15_000;
/** The bound CICD-06 FR 3 sets for a kill switch to take effect. */
export const KILL_SWITCH_MAX_DELAY_MS = 60_000;
/** Test-space answers cached between refreshes; the cache is emptied when it grows past this. */
const TEST_CACHE_MAX = 10_000;

/** The flag and kill-switch check of the API (CICD-06): one per process, wired in src/api.ts. */
export interface FlagRuntime {
  /** False while the module's kill switch is on (and before the state was ever loaded). */
  isModuleAvailable(module: string): Promise<boolean>;
  /** Is the flag on for this space? An unknown key is a programming error. */
  isEnabled(householdId: string, flag: string): Promise<boolean>;
  /** The flags that are on for this space (only those: a client never learns of a hidden function). */
  enabledFlags(householdId: string): Promise<FlagKey[]>;
  /** Reloads the state now. */
  refresh(): Promise<void>;
  /** Has the state been loaded at least once? (readiness) */
  readonly loaded: boolean;
}

export interface FlagRuntimeOptions {
  readonly now?: () => number;
  readonly refreshMs?: number;
}

/** Evaluates a flag on a snapshot (also used by GET /v1/me/features). */
export async function flagOn(
  snapshot: FlagSnapshot,
  flag: string,
  householdId: string,
  isTestHousehold: () => Promise<boolean>,
): Promise<boolean> {
  if (!isFlagKey(flag)) throw new Error(`Unknown flag ${flag} (feature-flags)`);
  return isOnFor(flag, snapshot.rollouts.get(flag) ?? OFF, householdId, isTestHousehold);
}

export async function flagsOn(
  snapshot: FlagSnapshot,
  householdId: string,
  isTestHousehold: () => Promise<boolean>,
): Promise<FlagKey[]> {
  // One lookup at most, shared by every flag at «test» or «share».
  let test: Promise<boolean> | undefined;
  const once = () => (test ??= isTestHousehold());
  const on: FlagKey[] = [];
  for (const key of FLAG_KEYS) if (await flagOn(snapshot, key, householdId, once)) on.push(key);
  return on;
}

/**
 * The state is cached per process and reloaded by the first request after `refreshMs` (one reload at a
 * time). If a reload fails, the last state stays in force and the next request tries again; before the
 * first successful load every module answers «temporarily unavailable» and every flag is off.
 */
export function createFlagRuntime(store: FlagStore, options: FlagRuntimeOptions = {}): FlagRuntime {
  const now = options.now ?? Date.now;
  const refreshMs = options.refreshMs ?? REFRESH_MS;
  if (refreshMs > KILL_SWITCH_MAX_DELAY_MS) throw new Error("refreshMs must not exceed 60 s (CICD-06 FR 3)");
  let snapshot: FlagSnapshot | undefined;
  let loadedAt = Number.NEGATIVE_INFINITY;
  let inflight: Promise<void> | undefined;
  const testCache = new Map<string, Promise<boolean>>();

  const reload = (): Promise<void> =>
    (inflight ??= store
      .snapshot()
      .then((next) => {
        snapshot = next;
        loadedAt = now();
        testCache.clear();
      })
      .finally(() => {
        inflight = undefined;
      }));

  const current = async (): Promise<FlagSnapshot | undefined> => {
    if (now() - loadedAt >= refreshMs) await reload().catch(() => undefined);
    return snapshot;
  };

  const isTest = (householdId: string) => () => {
    let cached = testCache.get(householdId);
    if (!cached) {
      if (testCache.size >= TEST_CACHE_MAX) testCache.clear();
      cached = store.isTestHousehold(householdId);
      testCache.set(householdId, cached);
      // A failed lookup is not remembered.
      cached.catch(() => testCache.delete(householdId));
    }
    return cached;
  };

  return {
    get loaded() {
      return snapshot !== undefined;
    },
    refresh: reload,
    isModuleAvailable: async (module) => {
      const s = await current();
      return s !== undefined && !s.killed.has(module);
    },
    isEnabled: async (householdId, flag) => {
      if (!isFlagKey(flag)) throw new Error(`Unknown flag ${flag} (feature-flags)`);
      const s = await current();
      return s !== undefined && flagOn(s, flag, householdId, isTest(householdId));
    },
    enabledFlags: async (householdId) => {
      const s = await current();
      return s === undefined ? [] : flagsOn(s, householdId, isTest(householdId));
    },
  };
}
