// Adapters of fx-rates: database (ModuleDatabase, schema «fx_rates») and the rate feeds (ARC-05).
import { systemClock, type ProviderMode } from "../../../platform/adapters/index.ts";
import type { ModuleDatabase } from "../../../platform/db/module-db.ts";
import {
  createFxRateReader,
  startFxRefresh,
  type FxClock,
  type FxRateFeed,
  type FxRates,
  type FxRefreshDeps,
  type FxRefreshLoop,
} from "../application/index.ts";
import { databaseFxRateStore } from "./db/store.ts";
import { fxRateFeed } from "./feeds/index.ts";

export { databaseFxRateStore } from "./db/store.ts";
export {
  FX_RATE_FEEDS,
  NBU_BASE_URL,
  OFFICIAL_RATES_PORT,
  SYNTHETIC_CURRENCIES,
  fxRateFeed,
  nbuRateFeed,
  parseNbuRates,
  syntheticRateFeed,
} from "./feeds/index.ts";
export type { NbuFeedOptions } from "./feeds/index.ts";

/** Reading rates for display, from the module's history (other modules: net worth, accounts). */
export function createFxRates(options: { db: ModuleDatabase; now?: () => number }): FxRates {
  return createFxRateReader({ store: databaseFxRateStore(options.db), now: options.now ?? Date.now });
}

/**
 * The scheduler's daily update with retries (VAL-05 FR 1, 2, 4). `mode` picks the feed (`WS_PROVIDER_MODE`): the
 * NBU in deployed environments, the synthetic feed locally and in CI; a test may pass its own `feed`.
 */
export function startFxRatesRefresh(options: {
  db: ModuleDatabase;
  mode: ProviderMode;
  report: FxRefreshDeps["report"];
  run?: FxRefreshDeps["run"];
  feed?: FxRateFeed;
  clock?: FxClock;
  firstDelayMs?: number;
}): FxRefreshLoop {
  return startFxRefresh(
    {
      feed: options.feed ?? fxRateFeed(options.mode),
      store: databaseFxRateStore(options.db),
      clock: options.clock ?? systemClock,
      report: options.report,
      ...(options.run ? { run: options.run } : {}),
    },
    options.firstDelayMs !== undefined ? { firstDelayMs: options.firstDelayMs } : {},
  );
}
