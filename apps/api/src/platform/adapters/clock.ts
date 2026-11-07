/**
 * Time as the adapter kit sees it (ADR-0005). The system clock reads the global timer functions at call
 * time, so tests can drive it with fake timers (`vi.useFakeTimers()`) or pass their own clock; no test
 * waits for real time.
 */
export interface AdapterClock {
  /** Milliseconds since the epoch. */
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: AdapterClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function sleep(clock: AdapterClock, ms: number): Promise<void> {
  return new Promise((resolve) => {
    clock.setTimeout(resolve, ms);
  });
}
