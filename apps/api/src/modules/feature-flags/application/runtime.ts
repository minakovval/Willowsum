import { FLAGS, isOnFor, MAX_REQUIRES_DEPTH, OFF, type FlagKey } from "../domain/index.ts";
import type { FlagSnapshot, FlagStore } from "./ports.ts";

/**
 * How old the cached state may get before a request reloads it. A kill switch or a rollout change made
 * through FlagAdmin reaches every API process within this time, without a release (CICD-06 FR 3: ≤ 1 min).
 */
export const REFRESH_MS = 15_000;
/**
 * The bound CICD-06 FR 3 sets for a kill switch to take effect. It also bounds how old the state in force may
 * get: state read more than this long ago (the reloads failed or hang) is not used — every module answers
 * «temporarily unavailable» and the api role is not ready — so a kill switch can never be missed for longer.
 */
export const KILL_SWITCH_MAX_DELAY_MS = 60_000;
/** How long a request waits for a reload before it answers from the state in force (a slow database). */
export const LOAD_WAIT_MS = 2_000;
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
  /** Reloads the state now; waits at most LOAD_WAIT_MS and never fails (see `fresh`). */
  refresh(): Promise<void>;
  /** Has the state been loaded at least once? */
  readonly loaded: boolean;
  /** Is the state in force younger than KILL_SWITCH_MAX_DELAY_MS? (readiness) */
  readonly fresh: boolean;
}

export interface FlagRuntimeOptions {
  readonly now?: () => number;
  readonly refreshMs?: number;
}

/** The part of the flag catalogue the evaluation needs: which flags exist and which flag each one requires. */
export type FlagCatalogue = Readonly<Record<string, { readonly kind: string; readonly requires?: string }>>;

/**
 * Evaluates a flag on a snapshot (also used by GET /v1/me/features). A flag that `requires` another (a
 * sub-function's flag requires its function's) is on only while that one is on too — the same rule the API
 * applies to a route's flags (routeFlags), so a sub-function is never listed while its function is hidden.
 */
export async function flagOn(
  snapshot: FlagSnapshot,
  flag: string,
  householdId: string,
  isTestHousehold: () => Promise<boolean>,
  catalogue: FlagCatalogue = FLAGS,
): Promise<boolean> {
  let key: string | undefined = flag;
  for (let depth = 0; key !== undefined; depth++) {
    if (!Object.hasOwn(catalogue, key)) throw new Error(`Unknown flag ${key} (feature-flags)`);
    if (depth > MAX_REQUIRES_DEPTH)
      throw new Error(`Flag ${flag}: «requires» chains too deep (feature-flags)`);
    if (!(await isOnFor(key, snapshot.rollouts.get(key) ?? OFF, householdId, isTestHousehold))) return false;
    key = catalogue[key]!.requires;
  }
  return true;
}

export async function flagsOn(
  snapshot: FlagSnapshot,
  householdId: string,
  isTestHousehold: () => Promise<boolean>,
  catalogue: FlagCatalogue = FLAGS,
): Promise<FlagKey[]> {
  // One lookup at most, shared by every flag at «test» or «share».
  let test: Promise<boolean> | undefined;
  const once = () => (test ??= isTestHousehold());
  const on: FlagKey[] = [];
  for (const key of Object.keys(catalogue))
    if (await flagOn(snapshot, key, householdId, once, catalogue)) on.push(key as FlagKey);
  return on;
}

/** What the readiness probe of the api role says about the flags (ADR-0004). */
export type FlagsReadiness = "ok" | "flags-not-loaded" | "flags-stale";

/** Ready only on fresh state: never loaded → «flags-not-loaded»; loaded but 60 s old or more → «flags-stale». */
export function flagsReadiness(state: { readonly loaded: boolean; readonly fresh: boolean }): FlagsReadiness {
  if (state.fresh) return "ok";
  return state.loaded ? "flags-stale" : "flags-not-loaded";
}

/** The readiness check main.ts runs: a reload (bounded by LOAD_WAIT_MS) when the state is not fresh, then the decision. */
export async function checkFlagsReady(
  runtime: Pick<FlagRuntime, "loaded" | "fresh" | "refresh">,
): Promise<FlagsReadiness> {
  if (!runtime.fresh) await runtime.refresh();
  return flagsReadiness(runtime);
}

/**
 * The state is cached per process. Its age counts from the moment its load started (what it shows was true
 * then), so a slow load does not stretch the 15 s. The first request after `refreshMs` starts a reload (one at
 * a time) and waits for it at most LOAD_WAIT_MS; if the reload fails or is still running, the state in force
 * answers while it is younger than KILL_SWITCH_MAX_DELAY_MS. Without such state — never loaded, or the last
 * successful load started 60 s ago or more — every module answers «temporarily unavailable» and every flag
 * is off.
 */
export function createFlagRuntime(store: FlagStore, options: FlagRuntimeOptions = {}): FlagRuntime {
  const now = options.now ?? Date.now;
  const refreshMs = options.refreshMs ?? REFRESH_MS;
  if (refreshMs > KILL_SWITCH_MAX_DELAY_MS) throw new Error("refreshMs must not exceed 60 s (CICD-06 FR 3)");
  let snapshot: FlagSnapshot | undefined;
  /** When the load of `snapshot` started. */
  let loadedAt = Number.NEGATIVE_INFINITY;
  let inflight: Promise<void> | undefined;
  const testCache = new Map<string, Promise<boolean>>();

  const reload = (): Promise<void> =>
    (inflight ??= (async () => {
      // Only one load runs at a time (inflight), so each finished load is the newest.
      const started = now();
      snapshot = await store.snapshot();
      loadedAt = started;
      testCache.clear();
    })().finally(() => {
      inflight = undefined;
    }));

  const fresh = () => snapshot !== undefined && now() - loadedAt < KILL_SWITCH_MAX_DELAY_MS;

  const refresh = async (): Promise<void> => {
    const done = reload().catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, LOAD_WAIT_MS);
    });
    await Promise.race([done, waited]);
    clearTimeout(timer);
  };

  const current = async (): Promise<FlagSnapshot | undefined> => {
    if (now() - loadedAt >= refreshMs) await refresh();
    return fresh() ? snapshot : undefined;
  };

  /**
   * Is the space a test space? Asked only at «test» and «share» (outside the share). Bounded like a reload: an
   * answer that does not come within LOAD_WAIT_MS counts as «not a test space» for this request (the function
   * stays hidden: fail closed) and is not remembered; a failed lookup is not remembered either.
   */
  const isTest = (householdId: string) => () => {
    let cached = testCache.get(householdId);
    if (!cached) {
      if (testCache.size >= TEST_CACHE_MAX) testCache.clear();
      const lookup = store.isTestHousehold(householdId);
      testCache.set(householdId, lookup);
      lookup.catch(() => testCache.delete(householdId));
      cached = lookup;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        if (testCache.get(householdId) === cached) testCache.delete(householdId);
        resolve(false);
      }, LOAD_WAIT_MS);
    });
    return Promise.race([cached, late]).finally(() => clearTimeout(timer));
  };

  return {
    get loaded() {
      return snapshot !== undefined;
    },
    get fresh() {
      return fresh();
    },
    refresh,
    isModuleAvailable: async (module) => {
      const s = await current();
      return s !== undefined && !s.killed.has(module);
    },
    isEnabled: async (householdId, flag) => {
      if (!Object.hasOwn(FLAGS, flag)) throw new Error(`Unknown flag ${flag} (feature-flags)`);
      const s = await current();
      return s !== undefined && flagOn(s, flag, householdId, isTest(householdId));
    },
    enabledFlags: async (householdId) => {
      const s = await current();
      return s === undefined ? [] : flagsOn(s, householdId, isTest(householdId));
    },
  };
}
