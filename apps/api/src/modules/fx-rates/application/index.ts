// Application layer of fx-rates: use cases (ARC-01 FR 5). Uses ports; adapters are wired in ../adapters.
export { createFxRateReader } from "./rates.ts";
export type { FxConversion, FxFreshness, FxRates, QuotedRate } from "./rates.ts";
export { FIRST_ATTEMPT_DELAY_MS, refreshRates, startFxRefresh } from "./refresh.ts";
export type { FxAttemptOutcome, FxRefreshDeps, FxRefreshLoop } from "./refresh.ts";
export type { FxClock, FxRateFeed, FxRateStore, FxRefreshEvent, FxStaleAlert, RatesOfDate } from "./ports.ts";
