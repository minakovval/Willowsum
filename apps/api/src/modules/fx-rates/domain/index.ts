// Domain layer of fx-rates: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export {
  NBU_SOURCE,
  PIVOT_CURRENCY,
  QUICK_RETRIES,
  QUICK_RETRY_MS,
  REFRESH_INTERVAL_MS,
  RateUnavailableError,
  STALE_AFTER_MS,
  crossRate,
  kyivDate,
  retryDelayMs,
  staleAlertMessage,
  stalePeriodKey,
} from "./rates.ts";
export type { PivotRate } from "./rates.ts";
