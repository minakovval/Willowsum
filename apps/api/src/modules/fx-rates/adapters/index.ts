// Adapters of fx-rates: database (ModuleDatabase, schema «fx_rates») and the rate feeds (ARC-05).
import { systemClock, type ProviderMode } from "../../../platform/adapters/index.ts";
import type { MailSender } from "../../../platform/adapters/mail/index.ts";
import type { ModuleDatabase } from "../../../platform/db/module-db.ts";
import { staleAlertMessage } from "../domain/index.ts";
import {
  createFxRateReader,
  createFxReportingReader,
  startFxRefresh,
  type FxClock,
  type FxRateFeed,
  type FxRates,
  type FxReporting,
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
 * Amounts in the space's reporting currency (VAL-04@PoC): conversion at the official rate of each amount's date,
 * «приблизно» with the nearest earlier rate, «Курс недоступний» without any rate. Reads the module's history only.
 */
export function createFxReporting(options: { db: ModuleDatabase; now?: () => number }): FxReporting {
  const now = options.now ?? Date.now;
  return createFxReportingReader({ fx: createFxRates({ db: options.db, now }), now });
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
  /**
   * The alert letter after 24 h without an update (FR 4, AC2): the app's mail adapter and the product owner's
   * address (`WS_ALERT_EMAIL`). Without it only the error-level log event is written.
   */
  alertMail?: { mail: MailSender; to: string };
  firstDelayMs?: number;
}): FxRefreshLoop {
  return startFxRefresh(
    {
      feed: options.feed ?? fxRateFeed(options.mode),
      store: databaseFxRateStore(options.db),
      clock: options.clock ?? systemClock,
      report: options.report,
      ...(options.run ? { run: options.run } : {}),
      ...(options.alertMail ? { alert: mailAlert(options.alertMail) } : {}),
    },
    options.firstDelayMs !== undefined ? { firstDelayMs: options.firstDelayMs } : {},
  );
}

/** The stale-rates letter through the mail adapter; its text holds no amounts (domain `staleAlertMessage`). */
function mailAlert({ mail, to }: { mail: MailSender; to: string }) {
  return async (info: { lastSuccessAt: number | null; failures: number }) => {
    await mail.send({ to, ...staleAlertMessage(info) });
  };
}
