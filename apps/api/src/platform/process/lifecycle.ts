/**
 * Graceful stop (ARC-02 FR 5). On SIGTERM or SIGINT every stop hook runs; the process exits when they
 * finish or when the timeout (default 30 s) runs out. The API's hook stops accepting connections and
 * finishes the requests in flight; the worker's hook returns unfinished jobs to the queue (ARC-04).
 */
export type StopHook = () => Promise<void>;

export interface Lifecycle {
  onStop(hook: StopHook): void;
  /** Runs the stop hooks once; resolves with "clean" or "timeout". */
  stop(): Promise<"clean" | "timeout">;
}

export function createLifecycle(timeoutMs: number): Lifecycle {
  const hooks: StopHook[] = [];
  let stopping: Promise<"clean" | "timeout"> | undefined;
  return {
    onStop(hook) {
      hooks.push(hook);
    },
    stop() {
      stopping ??= new Promise((resolve) => {
        const timer = setTimeout(() => resolve("timeout"), timeoutMs);
        // Hooks run in reverse order of registration: the last thing started stops first.
        void [...hooks]
          .reverse()
          .reduce((chain, hook) => chain.then(hook).catch(() => undefined), Promise.resolve())
          .then(() => {
            clearTimeout(timer);
            resolve("clean");
          });
      });
      return stopping;
    },
  };
}
