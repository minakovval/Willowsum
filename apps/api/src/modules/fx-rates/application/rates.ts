import { convert, type Conversion, type ExchangeRate, type Money } from "@willowsum/domain-kernel";
import { PIVOT_CURRENCY, RateUnavailableError, crossRate, STALE_AFTER_MS } from "../domain/index.ts";
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
  /** Converts for display; the result keeps the rate, its date and its source (amounts stay in their currency). */
  convert(amount: Money, to: string, date: string): Promise<FxConversion>;
  freshness(): Promise<FxFreshness>;
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
    const needed = [from, to].filter((c) => c !== PIVOT_CURRENCY);
    const found = await deps.store.ratesOnOrBefore(needed, date);
    if (!found) throw new RateUnavailableError();
    return { rate: crossRate(from, to, found.date, found.source, found.rates), ...(await freshness()) };
  };
  return {
    rate,
    async convert(amount, to, date) {
      const { rate: r, ...fresh } = await rate(amount.currency, to, date);
      return { conversion: convert(amount, r, date), ...fresh };
    },
    freshness,
  };
}

/**
 * The official rates as the list totals read them (DAT-01@PoC FR 12; `platform/lists/list-total.ts`): the rate of
 * the date or the nearest earlier one, and null — never a zero rate — when there is none.
 */
export function officialDatedRates(fx: Pick<FxRates, "rate">): {
  rate(from: string, to: string, date: string): Promise<ExchangeRate | null>;
} {
  return {
    async rate(from, to, date) {
      try {
        return (await fx.rate(from, to, date)).rate;
      } catch (error) {
        if (error instanceof RateUnavailableError) return null;
        throw error;
      }
    },
  };
}
