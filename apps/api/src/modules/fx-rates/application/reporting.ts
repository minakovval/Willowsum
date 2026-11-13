import { Money, convert, currencyInfo, type Conversion } from "@willowsum/domain-kernel";
import { REPORTING_CURRENCY, isRestrictedConvertibility, kyivDate, rateCoversDate } from "../domain/index.ts";
import type { FxRates } from "./rates.ts";

/**
 * An amount in its original currency and the date whose rate converts it (VAL-04@PoC business rules): a
 * transaction — its own date; a balance — `null`, the date of display («today», the Kyiv date: NBU rates are set
 * for Kyiv calendar days).
 */
export interface DatedAmount {
  readonly amount: Money;
  /** YYYY-MM-DD, or null for «today». */
  readonly date: string | null;
}

/**
 * One amount as shown in the reporting currency. The original amount is never changed or rounded (FR 1); the value
 * is unrounded (rounding is for display).
 * - `reporting-currency`: already in the reporting currency, nothing converted;
 * - `converted`: `conversion` keeps the rate, its date, its source and the requested date (business rules);
 *   `conversion.approximate` — the nearest earlier rate was used (edge case 3), never for a weekend that takes the
 *   previous working day's rate (AC4) and never for «today», which uses the latest daily rate (FR 3);
 *   `restricted` — a currency with restricted convertibility: «Офіційний курс, ринковий може відрізнятися» (edge case 2);
 * - `rate-unavailable`: no rate on or before the date at all: shown in its own currency with «Курс недоступний»
 *   (edge case 4).
 */
export type ReportedAmount =
  | { readonly kind: "reporting-currency"; readonly original: Money; readonly value: Money }
  | {
      readonly kind: "converted";
      readonly original: Money;
      readonly value: Money;
      readonly conversion: Conversion;
      readonly restricted: boolean;
    }
  | { readonly kind: "rate-unavailable"; readonly original: Money };

/** A total in the reporting currency (edge cases 3, 4). */
export interface ReportedTotal {
  readonly currency: string;
  /** Sum of every amount with a rate (unrounded); null when amounts exist and none has a rate — never 0. */
  readonly total: Money | null;
  /** «приблизно»: some amount used the nearest earlier rate, or some amount has no rate and is left out. */
  readonly approximate: boolean;
  /** Amounts converted at the nearest earlier rate. */
  readonly nearestRateCount: number;
  /** Amounts left out of the total, «Курс недоступний» (the hint names this number). */
  readonly unavailableCount: number;
  /** Some amount is in a currency with restricted convertibility. */
  readonly restricted: boolean;
  /** Each amount, in the order given. */
  readonly items: readonly ReportedAmount[];
}

export interface FxReporting {
  /** One amount in the reporting currency (default: the space's, EUR in this release). */
  toReporting(amount: DatedAmount, reportingCurrency?: string): Promise<ReportedAmount>;
  /** Many amounts and their total; all their rates are read in one query. */
  total(amounts: readonly DatedAmount[], reportingCurrency?: string): Promise<ReportedTotal>;
}

/**
 * Conversion into the reporting currency for display and calculation (VAL-04@PoC FR 1–4). Reads only the rate
 * history (`FxRates.rates`): the rate of the date or the nearest earlier one, cross rates through the hryvnia from
 * one date and one source. Nothing is stored or changed: a later call with the date's rate gives the exact value.
 */
export function createFxReportingReader(deps: {
  fx: Pick<FxRates, "rates">;
  now: () => number;
}): FxReporting {
  const total = async (
    amounts: readonly DatedAmount[],
    reportingCurrency: string = REPORTING_CURRENCY,
  ): Promise<ReportedTotal> => {
    currencyInfo(reportingCurrency); // an unknown unit is refused (FR 5)
    const today = kyivDate(deps.now());
    const dateOf = (a: DatedAmount) => a.date ?? today;
    const requests: { from: string; to: string; date: string }[] = [];
    const index = new Map<string, number>();
    for (const a of amounts) {
      if (a.amount.currency === reportingCurrency) continue;
      const key = `${a.amount.currency}|${dateOf(a)}`;
      if (index.has(key)) continue;
      index.set(key, requests.length);
      requests.push({ from: a.amount.currency, to: reportingCurrency, date: dateOf(a) });
    }
    const rates = requests.length === 0 ? [] : await deps.fx.rates(requests);
    if (rates.length !== requests.length) throw new Error("fx-rates: one rate per request expected");

    let sum = Money.zero(reportingCurrency);
    let counted = 0;
    let nearestRateCount = 0;
    let unavailableCount = 0;
    let restricted = false;
    const items = amounts.map((a): ReportedAmount => {
      if (a.amount.currency === reportingCurrency) {
        sum = sum.plus(a.amount);
        counted += 1;
        return { kind: "reporting-currency", original: a.amount, value: a.amount };
      }
      const date = dateOf(a);
      const rate = rates[index.get(`${a.amount.currency}|${date}`)!] ?? null;
      if (rate === null) {
        unavailableCount += 1;
        return { kind: "rate-unavailable", original: a.amount };
      }
      // `convert` refuses a rate from after `date`.
      const exact = convert(a.amount, rate, date);
      const approximate = a.date !== null && !rateCoversDate(rate.date, date);
      const conversion: Conversion = { ...exact, approximate };
      const isRestricted =
        isRestrictedConvertibility(a.amount.currency) || isRestrictedConvertibility(reportingCurrency);
      sum = sum.plus(conversion.to);
      counted += 1;
      if (approximate) nearestRateCount += 1;
      if (isRestricted) restricted = true;
      return {
        kind: "converted",
        original: a.amount,
        value: conversion.to,
        conversion,
        restricted: isRestricted,
      };
    });
    return {
      currency: reportingCurrency,
      total: unavailableCount > 0 && counted === 0 ? null : sum,
      approximate: nearestRateCount > 0 || unavailableCount > 0,
      nearestRateCount,
      unavailableCount,
      restricted,
      items,
    };
  };
  return {
    async toReporting(amount, reportingCurrency) {
      return (await total([amount], reportingCurrency)).items[0]!;
    },
    total,
  };
}
