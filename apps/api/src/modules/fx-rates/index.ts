// Public interface of the fx-rates module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const fxRatesModule = defineModule({
  name: "fx-rates",
  publishes: [],
  consumes: [],
});

export { createFxRates, createFxReporting, startFxRatesRefresh } from "./adapters/index.ts";
export { officialDatedRates } from "./application/index.ts";
export type {
  DatedAmount,
  FxAttemptOutcome,
  FxClock,
  FxConversion,
  FxFreshness,
  FxRateFeed,
  FxRates,
  FxRefreshEvent,
  FxRefreshLoop,
  FxReporting,
  QuotedRate,
  RateRequest,
  ReportedAmount,
  ReportedTotal,
} from "./application/index.ts";
export {
  NBU_SOURCE,
  PIVOT_CURRENCY,
  REFRESH_INTERVAL_MS,
  REPORTING_CURRENCY,
  RESTRICTED_CONVERTIBILITY,
  RateUnavailableError,
  STALE_AFTER_MS,
  isRestrictedConvertibility,
  rateCoversDate,
  retryDelayMs,
} from "./domain/index.ts";
export type { PivotRate } from "./domain/index.ts";
