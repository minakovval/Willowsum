import {
  kyivDate,
  retryDelayMs,
  REFRESH_INTERVAL_MS,
  STALE_AFTER_MS,
  stalePeriodKey,
} from "../domain/index.ts";
import type { FxClock, FxRateFeed, FxRateStore, FxRefreshEvent, FxStaleAlert } from "./ports.ts";

/** The first attempt waits a minute after the start: a crash loop never calls the provider on every start. */
export const FIRST_ATTEMPT_DELAY_MS = 60 * 1000;

export interface FxRefreshDeps {
  readonly feed: FxRateFeed;
  readonly store: FxRateStore;
  readonly clock: FxClock;
  readonly report: (event: FxRefreshEvent) => void;
  /** The alert letter to the product owner; without it (no recipient configured) only the log event remains. */
  readonly alert?: FxStaleAlert;
  /** Wraps each attempt (the scheduler traces it as a scheduled task). */
  readonly run?: <T>(work: () => Promise<T>) => Promise<T>;
}

/**
 * One update (VAL-05 FR 1, AC1): the official rates of every currency the source publishes for today's date
 * in Kyiv, stored with their date and source. Idempotent: a second run on the same day rewrites the same rows.
 */
export async function refreshRates(deps: Pick<FxRefreshDeps, "feed" | "store" | "clock">): Promise<number> {
  const now = deps.clock.now();
  const date = kyivDate(now);
  const rates = await deps.feed.dailyRates(date);
  if (rates.length === 0) throw new Error("The feed returned no rates");
  if (rates.some((r) => r.date > date)) throw new Error("A rate of a later date is never stored");
  await deps.store.saveUpdate({ rates, feed: deps.feed.name, requestedDate: date, completedAt: now });
  return rates.length;
}

const classOf = (error: unknown): string =>
  error instanceof Error ? error.constructor.name || error.name : typeof error;

async function sendAlertOnce(
  deps: FxRefreshDeps,
  alert: FxStaleAlert,
  lastSuccessAt: number | null,
  failures: number,
  now: number,
): Promise<void> {
  const period = stalePeriodKey(lastSuccessAt);
  try {
    if (!(await deps.store.claimStaleAlert(period, now))) return;
  } catch (error) {
    deps.report({ kind: "alert-failed", errorClass: classOf(error) });
    return;
  }
  try {
    await alert({ lastSuccessAt, failures });
    deps.report({ kind: "alert-sent" });
  } catch (error) {
    deps.report({ kind: "alert-failed", errorClass: classOf(error) });
    await deps.store.releaseStaleAlert(period).catch(() => undefined);
  }
}

export type FxAttemptOutcome = "updated" | "failed";

export interface FxRefreshLoop {
  /** One attempt now (the timer calls it too); resolves with its outcome. */
  attempt(): Promise<FxAttemptOutcome>;
  /** No more attempts; resolves when an attempt in progress has finished. */
  stop(): Promise<void>;
}

/**
 * The daily background task with retries (VAL-05 FR 1, FR 2, FR 4; AC1, AC2). After a success the next update
 * is a day later. After a failure it is retried: three times at a short pause, then at 1 h, 2 h, 4 h, … but never
 * more than 24 h apart. Once the update has been missed for 24 h (counted from when it was due, a day after the last
 * success, or from the start before the first success), every failed attempt reports a `stale` event (an error-level event in the server log), and the first of them in a stale period sends the one
 * alert letter of that period (claimed in the store, so a restart or a second scheduler sends no second letter).
 */
export function startFxRefresh(
  deps: FxRefreshDeps,
  options: { readonly firstDelayMs?: number } = {},
): FxRefreshLoop {
  const startedAt = deps.clock.now();
  const run = deps.run ?? (<T>(work: () => Promise<T>) => work());
  let failures = 0;
  let timer: unknown;
  let stopped = false;
  let running: Promise<FxAttemptOutcome> | undefined;

  const arm = (delay: number) => {
    if (stopped) return;
    timer = deps.clock.setTimeout(() => {
      void attempt();
    }, delay);
    (timer as { unref?: () => void } | undefined)?.unref?.();
  };

  const once = async (): Promise<FxAttemptOutcome> => {
    try {
      const currencies = await run(() => refreshRates(deps));
      failures = 0;
      deps.report({ kind: "updated", currencies });
      return "updated";
    } catch (error) {
      failures += 1;
      const errorClass = classOf(error);
      deps.report({ kind: "failed", failures, errorClass });
      const last = await deps.store.lastSuccessAt().catch(() => null);
      const now = deps.clock.now();
      // AC2 orders it «retries → 24 h without success → event»: the 24 h count from the moment the missed daily
      // update was due (a day after the last success), not from the success itself, so a single failed daily run
      // is retried before anything is logged at error level or mailed. Before the first success: from the start.
      const missedSince = last === null ? startedAt : last + REFRESH_INTERVAL_MS;
      if (now - missedSince >= STALE_AFTER_MS) {
        deps.report({ kind: "stale", failures });
        if (deps.alert) await sendAlertOnce(deps, deps.alert, last, failures, now);
      }
      return "failed";
    }
  };

  const attempt = (): Promise<FxAttemptOutcome> => {
    running ??= once().then((outcome) => {
      running = undefined;
      if (timer !== undefined) deps.clock.clearTimeout(timer);
      arm(outcome === "updated" ? REFRESH_INTERVAL_MS : retryDelayMs(failures));
      return outcome;
    });
    return running;
  };

  arm(options.firstDelayMs ?? FIRST_ATTEMPT_DELAY_MS);
  return {
    attempt,
    async stop() {
      stopped = true;
      if (timer !== undefined) deps.clock.clearTimeout(timer);
      await running;
    },
  };
}
