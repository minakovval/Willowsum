// Public interface of the fx-rates module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";

export const fxRatesModule = defineModule({
  name: "fx-rates",
  publishes: [],
  consumes: [],
});

export { createFxRates, startFxRatesRefresh } from "./adapters/index.ts";
export { officialDatedRates } from "./application/index.ts";
export type {
  FxAttemptOutcome,
  FxClock,
  FxConversion,
  FxFreshness,
  FxRateFeed,
  FxRates,
  FxRefreshEvent,
  FxRefreshLoop,
  QuotedRate,
  RateRequest,
} from "./application/index.ts";
export {
  NBU_SOURCE,
  PIVOT_CURRENCY,
  REFRESH_INTERVAL_MS,
  RateUnavailableError,
  STALE_AFTER_MS,
  retryDelayMs,
} from "./domain/index.ts";
export type { PivotRate } from "./domain/index.ts";
