import type { Decimal } from "@willowsum/domain-kernel";
import type { PivotRate } from "../domain/index.ts";

/**
 * The provider abstraction of exchange rates (VAL-05 FR 5): one interface for every source of official rates
 * to the hryvnia. Swapping the implementation changes nothing for the readers of the rates.
 */
export interface FxRateFeed {
  /** Technical name of the implementation, e.g. `nbu` or `synthetic` (for the update record). */
  readonly name: string;
  /** Official rates of every currency the source publishes for `date` (YYYY-MM-DD), never of a later date. */
  dailyRates(date: string): Promise<readonly PivotRate[]>;
}

/** Rates of one date and source, by currency (UAH per 1 unit). */
export interface RatesOfDate {
  readonly date: string;
  readonly source: string;
  readonly rates: ReadonlyMap<string, Decimal>;
}

/** The rate history in the module's own schema (VAL-05: history with source and date). */
export interface FxRateStore {
  /** Writes the rates of one successful update (an existing rate of the same date and currency is replaced). */
  saveUpdate(update: {
    readonly rates: readonly PivotRate[];
    readonly feed: string;
    readonly requestedDate: string;
    readonly completedAt: number;
  }): Promise<void>;
  /** When the last successful update finished (ms), or null when there was none. */
  lastSuccessAt(): Promise<number | null>;
  /** The latest date on or before `date` that has rates of all `currencies` from one source, with those rates. */
  ratesOnOrBefore(currencies: readonly string[], date: string): Promise<RatesOfDate | null>;
  /**
   * Claims the one alert of a stale period (FR 4): true for the first claim only, across restarts and scheduler
   * instances. `release` gives the claim back when the letter could not be sent, so a later attempt sends it.
   */
  claimStaleAlert(period: string, at: number): Promise<boolean>;
  releaseStaleAlert(period: string): Promise<void>;
}

/** Sends the alert letter of a stale period to the product owner (the app's mail adapter). */
export type FxStaleAlert = (info: { lastSuccessAt: number | null; failures: number }) => Promise<void>;

/** Time of the refresh loop: the scheduler passes the system clock, tests their own. */
export interface FxClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** What the refresh loop reports; the scheduler writes it to the server log. */
export type FxRefreshEvent =
  | { readonly kind: "updated"; readonly currencies: number }
  | { readonly kind: "failed"; readonly failures: number; readonly errorClass: string }
  /** No successful update for 24 h or more (FR 4, AC2): an error-level event. */
  | { readonly kind: "stale"; readonly failures: number }
  /** The alert letter of this stale period was sent, or could not be sent (retried at the next attempt). */
  | { readonly kind: "alert-sent" }
  | { readonly kind: "alert-failed"; readonly errorClass: string };
