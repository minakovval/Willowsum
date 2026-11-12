import { Decimal, RATE_MAX_SCALE, exchangeRate, type ExchangeRate } from "@willowsum/domain-kernel";

/**
 * Exchange rates of VAL-05@PoC. The one source is the National Bank of Ukraine (FR 3, owner decision
 * 2026-11-12): official rates of each currency to the hryvnia. Every other pair is a cross rate through the
 * hryvnia on the same date, and its source is the NBU too.
 */
export const PIVOT_CURRENCY = "UAH";
/** The source recorded with every rate (shown to users as «НБУ»). */
export const NBU_SOURCE = "NBU";

/** One official rate: 1 `currency` = `rate` UAH on `date`. */
export interface PivotRate {
  readonly currency: string;
  readonly rate: Decimal;
  readonly date: string;
  readonly source: string;
}

export class RateUnavailableError extends Error {
  constructor() {
    super("No rate on or before the requested date");
    this.name = "RateUnavailableError";
  }
}

/**
 * The rate `from` → `to` from two official rates of the same date (FR 3): 1 from = from.rate / to.rate units of
 * `to`. The hryvnia itself has no row: its rate to itself is 1. The quotient keeps 18 decimals (half to even),
 * the scale a rate may have (NFR-06).
 */
export function crossRate(
  from: string,
  to: string,
  date: string,
  source: string,
  pivotRates: ReadonlyMap<string, Decimal>,
): ExchangeRate {
  const one = new Decimal("1");
  const of = (currency: string): Decimal => {
    if (currency === PIVOT_CURRENCY) return one;
    const rate = pivotRates.get(currency);
    if (!rate) throw new RateUnavailableError();
    return rate;
  };
  const rate = of(from).dividedBy(of(to)).toDecimalPlaces(RATE_MAX_SCALE, Decimal.ROUND_HALF_EVEN);
  if (rate.isZero()) throw new RateUnavailableError();
  return exchangeRate({ base: from, quote: to, rate, date, source });
}

const HOUR_MS = 60 * 60 * 1000;
/** Rates are updated once a day (FR 2). */
export const REFRESH_INTERVAL_MS = 24 * HOUR_MS;
/**
 * FR 4, AC2: the update missed for this long → an error-level event in the server log and the alert letter. The
 * refresh task counts it from when the missed update was due (a day after the last success), so retries come
 * first; the «stale» mark next to amounts (`freshness`) counts it from the last success.
 */
export const STALE_AFTER_MS = 24 * HOUR_MS;
/** Failures retried at the short pause before the exponential pauses start (assumption of VAL-05@PoC). */
export const QUICK_RETRIES = 3;
/** Pause after each of the first three failures in a row (lead decision, not set by the requirement). */
export const QUICK_RETRY_MS = 15 * 60 * 1000;

/**
 * Pause before the next attempt after `failures` failed attempts in a row (FR 4; assumption of VAL-05@PoC):
 * after 3 failures in a row the pauses are 1 h, 2 h, 4 h and so on, doubling, but never above 24 h.
 */
export function retryDelayMs(failures: number): number {
  if (failures < 1) return REFRESH_INTERVAL_MS;
  if (failures < QUICK_RETRIES) return QUICK_RETRY_MS;
  return Math.min(HOUR_MS * 2 ** Math.min(failures - QUICK_RETRIES, 5), REFRESH_INTERVAL_MS);
}

const KYIV_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Kyiv",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date in Kyiv (YYYY-MM-DD): the date the NBU sets its official rates for. */
export function kyivDate(ms: number): string {
  return KYIV_DATE.format(new Date(ms));
}

/**
 * The stale period an alert belongs to: everything after one successful update (or, before the first one, the
 * whole time without any). At most one alert letter goes out per period (FR 4, AC2).
 */
export function stalePeriodKey(lastSuccessAt: number | null): string {
  return lastSuccessAt === null ? "never" : new Date(lastSuccessAt).toISOString();
}

/** `2026-11-12 14:00 UTC`: minutes only, so the letter carries no decimal-looking number. */
function utcMinute(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * The alert letter to the product owner (FR 4, AC2; owner decision 2026-11-12: PoC alerts are letters from the
 * app). Facts only: since when there is no update and how many attempts failed. No amounts, rates, currencies,
 * account names or personal data.
 */
export function staleAlertMessage(info: { lastSuccessAt: number | null; failures: number }): {
  subject: string;
  text: string;
} {
  const since =
    info.lastSuccessAt === null
      ? "Успішного оновлення ще не було."
      : `Останнє успішне оновлення: ${utcMinute(info.lastSuccessAt)}.`;
  return {
    subject: "Willowsum: курси валют не оновлювалися понад 24 год",
    text: [
      "Щоденне оновлення курсів валют не вдається понад 24 години.",
      since,
      `Невдалих спроб поспіль: ${info.failures}.`,
      "Застосунок показує суми за останніми успішними курсами і продовжує повторні спроби.",
      "Подробиці — подія fx_rates.stale у журналі сервера.",
      "Наступний такий лист прийде лише після нового успішного оновлення і нових 24 годин без нього.",
    ].join("\n"),
  };
}
