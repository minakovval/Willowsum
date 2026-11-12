import { Money, convert, type ExchangeRate } from "@willowsum/domain-kernel";
import type { AmountGroup } from "./list-engine.ts";

/**
 * The totals row of a list in several currencies (DAT-01@PoC FR 12, AC2–AC5, edge cases 2–4). Amounts in other
 * currencies are converted into the reporting currency at the free official reference rate (NBU; other pairs
 * cross through the hryvnia), never at the bank's actual rate or one the user typed: a transaction at the rate of
 * its own date, a value or balance at today's rate. With no rate on a transaction's date the nearest earlier rate
 * is used, and the total is «приблизно» with the number of such transactions; once the rate of that date exists
 * the same call gives the exact total. With no rate at all for some amount the total is not given: the row says
 * «немає курсу» with the number of records, never a total that silently counts them as 0.
 */

/**
 * Official dated rates, as the fx-rates module reads them (`FxRates.rate`): the rate of `date` or the nearest
 * earlier one, or null when there is none. The caller wires it; the engine never calls a provider.
 */
export interface DatedRates {
  rate(from: string, to: string, date: string): Promise<ExchangeRate | null>;
}

export interface ListTotal {
  /** Matching records within the caller's permissions. */
  readonly count: number;
  /** The total in the reporting currency (unrounded: rounding is for display), or null when `noRateCount` > 0. */
  readonly total: Money | null;
  /** Some amount was in another currency: the row shows the hint «конвертовано». */
  readonly converted: boolean;
  /** Some transaction was converted at the nearest earlier rate: the total is «приблизно». */
  readonly approximate: boolean;
  /** How many transactions were converted at the nearest earlier rate («N транзакцій за найближчим курсом»). */
  readonly nearestRateCount: number;
  /** How many records have no rate at all: then there is no total, only the marker «немає курсу». */
  readonly noRateCount: number;
}

const KYIV_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Kyiv",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The NBU sets its rates for Kyiv calendar days: «today» of a list is the Kyiv date of the injected clock. */
export function kyivToday(ms: number): string {
  return KYIV_DATE.format(new Date(ms));
}

export interface ListTotals {
  total(groups: readonly AmountGroup[], reportingCurrency: string): Promise<ListTotal>;
}

export function createListTotals(deps: { rates: DatedRates; now: () => number }): ListTotals {
  return {
    async total(groups, reportingCurrency) {
      const today = kyivToday(deps.now());
      let total = Money.zero(reportingCurrency);
      let converted = false;
      let nearestRateCount = 0;
      let noRateCount = 0;
      for (const group of groups) {
        if (group.currency === reportingCurrency) {
          total = total.plus(group.sum);
          continue;
        }
        converted = true;
        const date = group.date ?? today;
        const rate = await deps.rates.rate(group.currency, reportingCurrency, date);
        if (rate === null) {
          noRateCount += group.count;
          continue;
        }
        const conversion = convert(group.sum, rate, date);
        total = total.plus(conversion.to);
        // Only dated records count as «за найближчим курсом»; today's values use the latest official rate.
        if (conversion.approximate && group.date !== null) nearestRateCount += group.count;
      }
      return {
        count: groups.reduce((n, g) => n + g.count, 0),
        total: noRateCount > 0 ? null : total,
        converted,
        approximate: noRateCount === 0 && nearestRateCount > 0,
        nearestRateCount,
        noRateCount,
      };
    },
  };
}
