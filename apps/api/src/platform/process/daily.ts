import { runScheduled } from "../telemetry/jobs.ts";

/**
 * Daily tasks of the scheduler role (ACC-01 FR 6, NFR-12; ADR-0010), until the job queue of ARC-04 exists. Each
 * task runs shortly after the process starts and then every 24 h, one run at a time, as a trace of its own
 * (`runScheduled`: a failure is logged by its error class only and the next run tries again). A task must be
 * idempotent: a restart runs it again, and two scheduler instances may run it at the same time.
 */
export interface DailyTask {
  /** `<module>.<task>`, e.g. `identity.daily-cleanup`. */
  readonly name: string;
  readonly run: () => Promise<unknown>;
}

export const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** The first run waits a minute after the start: a crash loop never runs a task on every start. */
export const DAILY_FIRST_DELAY_MS = 60 * 1000;

export interface DailySchedule {
  /** Runs every task now (also used by the timer); resolves when they have finished. */
  runNow(): Promise<void>;
  /** No more runs; resolves when a run in progress has finished. */
  stop(): Promise<void>;
}

export function scheduleDaily(
  tasks: readonly DailyTask[],
  options: { readonly firstDelayMs?: number; readonly intervalMs?: number } = {},
): DailySchedule {
  const interval = options.intervalMs ?? DAILY_INTERVAL_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running: Promise<void> | undefined;

  const runNow = (): Promise<void> => {
    running ??= (async () => {
      for (const task of tasks) await runScheduled(task.name, task.run).catch(() => undefined);
    })().finally(() => {
      running = undefined;
    });
    return running;
  };
  const arm = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      void runNow().then(() => arm(interval));
    }, delay);
    timer.unref?.();
  };
  arm(options.firstDelayMs ?? DAILY_FIRST_DELAY_MS);

  return {
    runNow,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
