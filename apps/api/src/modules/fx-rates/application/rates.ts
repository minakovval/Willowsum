import { convert, type Conversion, type ExchangeRate, type Money } from "@willowsum/domain-kernel";
import {
  PIVOT_CURRENCY,
  RateUnavailableError,
  crossRate,
  fixedConversionRate,
  rateCoversDate,
  todayRateIsApproximate,
  STALE_AFTER_MS,
} from "../domain/index.ts";
import type { FxRateStore } from "./ports.ts";

/** Freshness of the rates: when the last successful update finished (users see «оновлено <дата і час>»). */
export interface FxFreshness {
  /** ISO 8601 (UTC) of the last successful update, or null before the first one. */
  readonly updatedAt: string | null;
  /** True when there has been no successful update for 24 h or more. */
  readonly stale: boolean;
}

export interface QuotedRate extends FxFreshness {
  readonly rate: ExchangeRate;
}

export interface FxConversion extends FxFreshness {
  readonly conversion: Conversion;
}

/**
 * Reading rates for display (VAL-05 FR 3, FR 4; business rules). Reads only the stored history, never the
 * provider: a provider outage does not block viewing, the last successful rates are used with the date of the
 * last update (AC4). A rate of the requested date, or else the nearest earlier one (the conversion is then marked
 * approximate). Every pair is a cross rate through the hryvnia on one date and from one source (AC5).
 */
export interface FxRates {
  rate(from: string, to: string, date: string): Promise<QuotedRate>;
  /**
   * Many rates in one read of the history (DAT-01@PoC FR 12: list totals): for each request the rate of its date
   * or the nearest earlier one, and null — never a zero rate and never a later date's rate — when there is none.
   * `from` and `to` differ. A database error rejects the whole call; it is never turned into null.
   */
  rates(requests: readonly RateRequest[]): Promise<(ExchangeRate | null)[]>;
  /**
   * Converts for display; the result keeps the rate, its date and its source (amounts stay in their currency).
   * `approximate` — the nearest earlier rate was used; a weekend's rate of the previous working day is not
   * approximate (VAL-04@PoC AC4).
   */
  convert(amount: Money, to: string, date: string): Promise<FxConversion>;
  freshness(): Promise<FxFreshness>;
}

/** One rate a caller needs: `from` → `to` on `date` (YYYY-MM-DD). */
export interface RateRequest {
  readonly from: string;
  readonly to: string;
  readonly date: string;
}

export function createFxRateReader(deps: { store: FxRateStore; now: () => number }): FxRates {
  const freshness = async (): Promise<FxFreshness> => {
    const last = await deps.store.lastSuccessAt();
    return {
      updatedAt: last === null ? null : new Date(last).toISOString(),
      stale: last === null || deps.now() - last >= STALE_AFTER_MS,
    };
  };
  const rate = async (from: string, to: string, date: string): Promise<QuotedRate> => {
    // A replaced currency converts to its successor at the fixed rate of the directory (ACC-06@PoC edge case 2).
    const fixed = fixedConversionRate(from, to, date);
    if (fixed) return { rate: fixed, ...(await freshness()) };
    const needed = [from, to].filter((c) => c !== PIVOT_CURRENCY);
    const found = await deps.store.ratesOnOrBefore(needed, date);
    if (!found) throw new RateUnavailableError();
    return { rate: crossRate(from, to, found.date, found.source, found.rates), ...(await freshness()) };
  };
  return {
    rate,
    async rates(requests) {
      if (requests.some((r) => r.from === r.to)) throw new Error("fx-rates: a rate needs two currencies");
      // Pairs the directory of replacements fixes (ACC-06@PoC edge case 2) never read the history.
      const fixed = requests.map((r) => fixedConversionRate(r.from, r.to, r.date));
      const open = requests.filter((_, i) => fixed[i] === null);
      const read =
        open.length === 0
          ? []
          : await deps.store.ratesOnOrBeforeEach(
              open.map((r) => ({
                currencies: [r.from, r.to].filter((c) => c !== PIVOT_CURRENCY),
                date: r.date,
              })),
            );
      if (read.length !== open.length) throw new Error("fx-rates: one day of rates per request expected");
      let next = 0;
      const found = fixed.map((f) => (f === null ? read[next++] : undefined));
      return requests.map((r, i) => {
        const fixedRate = fixed[i];
        if (fixedRate) return fixedRate;
        const day = found[i];
        if (!day) return null;
        try {
          return crossRate(r.from, r.to, day.date, day.source, day.rates);
        } catch (error) {
          if (error instanceof RateUnavailableError) return null;
          throw error;
        }
      });
    },
    async convert(amount, to, date) {
      const { rate: r, ...fresh } = await rate(amount.currency, to, date);
      const conversion = convert(amount, r, date);
      // A weekend takes the previous working day's rate: that is the rate of the date (VAL-04@PoC AC4).
      return { conversion: { ...conversion, approximate: !rateCoversDate(r.date, date) }, ...fresh };
    },
    freshness,
  };
}

/**
 * The official rates as the list totals read them (DAT-01@PoC FR 12; `platform/lists/list-total.ts`): one read
 * for all the rates of a total, each the rate of its date or the nearest earlier one, and null — never a zero
 * rate — when there is none. Errors other than a missing rate reject the call. `covers` — whether a rate is the
 * rate of a dated record's date (weekends); `staleForToday` — whether «today»'s rate is older than 3 calendar days
 * (VAL-04@PoC EC2).
 */
export function officialDatedRates(fx: Pick<FxRates, "rates">): {
  rates(requests: readonly RateRequest[]): Promise<(ExchangeRate | null)[]>;
  covers(rateDate: string, date: string): boolean;
  staleForToday(rateDate: string, today: string): boolean;
} {
  return {
    rates: (requests) => fx.rates(requests),
    covers: rateCoversDate,
    staleForToday: todayRateIsApproximate,
  };
}
