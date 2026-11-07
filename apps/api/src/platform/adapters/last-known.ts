import { systemClock, type AdapterClock } from "./clock.ts";
import { ProviderError } from "./errors.ts";

/**
 * «Last known value with its date» (ARC-05 FR 4, ADR-0005): a provider failure does not block reading. Every
 * successful load is remembered with the moment it was obtained; when a later load fails with a provider
 * error, the remembered value comes back marked `stale` with that moment, so the screen shows the value and
 * its date. With nothing remembered, the provider error is passed on (the caller shows its error state).
 */
export interface Observed<T> {
  readonly value: T;
  /** When the value was obtained from the provider (ISO 8601, UTC). */
  readonly asOf: string;
  /** True when the provider failed and this is the last known value. */
  readonly stale: boolean;
}

export interface LastKnownEntry<T> {
  readonly value: T;
  readonly asOf: string;
}

/** Where last known values live. In memory by default; a module may keep them in its own schema. */
export interface LastKnownStore<T> {
  get(key: string): Promise<LastKnownEntry<T> | undefined>;
  set(key: string, entry: LastKnownEntry<T>): Promise<void>;
}

/** In-process store holding at most `maxEntries` keys (the oldest written key goes first). */
export function memoryLastKnownStore<T>(maxEntries = 1_000): LastKnownStore<T> {
  const entries = new Map<string, LastKnownEntry<T>>();
  return {
    get: async (key) => entries.get(key),
    set: async (key, entry) => {
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
    },
  };
}

export interface LastKnown<T> {
  read(key: string, load: () => Promise<T>): Promise<Observed<T>>;
}

export function createLastKnown<T>(
  options: { store?: LastKnownStore<T>; clock?: AdapterClock } = {},
): LastKnown<T> {
  const store = options.store ?? memoryLastKnownStore<T>();
  const clock = options.clock ?? systemClock;
  return {
    async read(key, load) {
      let value: T;
      try {
        value = await load();
      } catch (error) {
        // Only a provider failure falls back; a bug or a refused outgoing field must stay visible.
        if (!(error instanceof ProviderError) || error.kind === "rejected") throw error;
        const last = await store.get(key);
        if (!last) throw error;
        return { value: last.value, asOf: last.asOf, stale: true };
      }
      const asOf = new Date(clock.now()).toISOString();
      await store.set(key, { value, asOf });
      return { value, asOf, stale: false };
    },
  };
}
