import { Money, convert, type ExchangeRate } from "@willowsum/domain-kernel";
import type { AmountGroup } from "./list-engine.ts";

/**
 * The totals row of a list in several currencies (DAT-01@PoC FR 12, AC2–AC6, edge cases 2–5). Amounts in other
 * currencies are converted into the reporting currency at the free official reference rate (NBU; other pairs
 * cross through the hryvnia), never at the bank's actual rate or one the user typed: a transaction at the rate of
 * its own date, a value or balance at today's rate. A value or balance whose latest rate is older than 3 calendar
 * days from today's Kyiv date makes the total «приблизно» (owner decision 2026-11-13; VAL-04@PoC edge case 2). With
 * no rate on a transaction's date the latest earlier rate is used, and the total is «приблизно» with the number of
 * such transactions; once the rate of that date exists
 * the same call gives the exact total. A record whose currency has no rate on or before its date at all is left
 * out (owner decision 2026-11-12): the total is the partial sum of the rest, marked «без N записів: немає курсу»;
 * such a record never counts as 0 and is never converted at a later date's rate. With no rate for any record there
 * is no total, only the marker. All the rates of one total are read at once (one query in fx-rates).
 */

/** One rate the total needs: `from` → `to` on `date` (YYYY-MM-DD). */
export interface DatedRateRequest {
  readonly from: string;
  readonly to: string;
  readonly date: string;
}

/**
 * Official dated rates, as the fx-rates module reads them (`officialDatedRates`): for each request the rate of
 * its date or the nearest earlier one, or null when there is none, in the order of the requests, in one read. The
 * caller wires it; the engine never calls a provider. A failure rejects: it is never shown as «немає курсу».
 */
export interface DatedRates {
  rates(requests: readonly DatedRateRequest[]): Promise<readonly (ExchangeRate | null)[]>;
  /** Whether a rate of `rateDate` is the rate of `date` (fx-rates' rule: a weekend takes the previous working day's rate). */
  covers(rateDate: string, date: string): boolean;
  /** Whether «today»'s value at a rate of `rateDate` is «приблизно» (fx-rates' rule: older than 3 calendar days). */
  staleForToday(rateDate: string, today: string): boolean;
}

export interface ListTotal {
  /** Matching records within the caller's permissions. */
  readonly count: number;
  /**
   * The total in the reporting currency (unrounded: rounding is for display). Without the records counted in
   * `noRateCount` (a partial total); null only when no record has a rate.
   */
  readonly total: Money | null;
  /** Some amount was in another currency: the row shows the hint «конвертовано». */
  readonly converted: boolean;
  /**
   * «приблизно»: some transaction was converted at the nearest earlier rate, or some value or balance at a rate
   * older than 3 calendar days.
   */
  readonly approximate: boolean;
  /** How many transactions were converted at the nearest earlier rate («N транзакцій за найближчим курсом»). */
  readonly nearestRateCount: number;
  /** How many values or balances (no date) were converted at a latest rate older than 3 calendar days. */
  readonly staleRateCount: number;
  /** Some records are left out of the total: the marker «без N записів: немає курсу». */
  readonly partial: boolean;
  /** How many records have no rate on or before their date at all (N of the marker). */
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
      const dateOf = (group: AmountGroup): string => group.date ?? today;
      // Every distinct (currency, date) the total needs, read in one call.
      const requests: DatedRateRequest[] = [];
      const index = new Map<string, number>();
      for (const group of groups) {
        if (group.currency === reportingCurrency) continue;
        const key = `${group.currency}|${dateOf(group)}`;
        if (index.has(key)) continue;
        index.set(key, requests.length);
        requests.push({ from: group.currency, to: reportingCurrency, date: dateOf(group) });
      }
      const rates = requests.length === 0 ? [] : await deps.rates.rates(requests);
      if (rates.length !== requests.length) throw new Error("list totals: one rate per request expected");

      let total = Money.zero(reportingCurrency);
      let counted = 0;
      let converted = false;
      let nearestRateCount = 0;
      let staleRateCount = 0;
      let noRateCount = 0;
      for (const group of groups) {
        if (group.currency === reportingCurrency) {
          total = total.plus(group.sum);
          counted += group.count;
          continue;
        }
        converted = true;
        const date = dateOf(group);
        const rate = rates[index.get(`${group.currency}|${date}`)!] ?? null;
        if (rate === null) {
          noRateCount += group.count;
          continue;
        }
        // `convert` refuses a rate dated after `date`: never a later date's rate.
        const conversion = convert(group.sum, rate, date);
        total = total.plus(conversion.to);
        counted += group.count;
        // Only dated records count as «за найближчим курсом»; a weekend that takes the previous working day's rate
        // is the rate of that date (same rule as fx-rates). Today's values use the latest official rate and are
        // «приблизно» only when it is older than 3 calendar days.
        if (group.date !== null) {
          if (!deps.rates.covers(conversion.rateDate, group.date)) nearestRateCount += group.count;
        } else if (deps.rates.staleForToday(conversion.rateDate, today)) staleRateCount += group.count;
      }
      return {
        count: groups.reduce((n, g) => n + g.count, 0),
        total: noRateCount > 0 && counted === 0 ? null : total,
        converted,
        approximate: nearestRateCount > 0 || staleRateCount > 0,
        nearestRateCount,
        staleRateCount,
        partial: noRateCount > 0,
        noRateCount,
      };
    },
  };
}
