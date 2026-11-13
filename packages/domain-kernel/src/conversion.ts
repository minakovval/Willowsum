import { isCurrencyCode } from "./currency.ts";
import { DomainError } from "./errors.ts";
import { AMOUNT_MAX_SCALE, Decimal, Money } from "./money.ts";

const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** A dated exchange rate: 1 unit of `base` = `rate` units of `quote` on `date`, published by `source`. */
export interface ExchangeRate {
  readonly base: string;
  readonly quote: string;
  readonly rate: Decimal;
  /** Calendar date the rate applies to (YYYY-MM-DD). */
  readonly date: string;
  /** Who published it, e.g. "ECB" or "NBU". */
  readonly source: string;
}

/**
 * The record of one conversion (NFR-06 FR 4): the original amount, the result, and the rate, its date
 * and its source. `approximate` is true when the rate is not of the date that was asked for (the nearest
 * earlier rate was used), so the display can mark the rate date. This is the plain comparison of dates; a
 * consumer may refine it: fx-rates does not mark a weekend that takes the previous working day's rate, nor
 * «today» (`rateCoversDate`). Consumers that show totals must apply the same rule, or two totals will disagree.
 */
export interface Conversion {
  readonly from: Money;
  readonly to: Money;
  readonly rate: Decimal;
  readonly rateDate: string;
  readonly source: string;
  readonly requestedDate: string;
  readonly approximate: boolean;
}

export class InvalidRateError extends DomainError {
  constructor(message: string) {
    super("INVALID_RATE", message);
  }
}

/** Rates have at most 18 decimals, so a product with an 18-decimal amount stays exact within 60 digits. */
export const RATE_MAX_SCALE = 18;

export function exchangeRate(rate: Omit<ExchangeRate, "rate"> & { rate: string | Decimal }): ExchangeRate {
  let value: unknown = rate.rate;
  if (typeof value === "string") {
    if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value))
      throw new InvalidRateError("A rate must be a positive decimal string");
    value = new Decimal(value);
  }
  const checked = { ...rate, rate: value as Decimal };
  assertValidRate(checked);
  return checked;
}

/** Checked again at the conversion boundary: an ExchangeRate built by hand gets no shortcut (NFR-06 FR 4). */
export function assertValidRate(rate: ExchangeRate): void {
  const value: unknown = rate?.rate;
  if (!(value instanceof Decimal) || !value.isFinite() || value.lte(0)) {
    throw new InvalidRateError("A rate must be a positive finite decimal");
  }
  if (value.decimalPlaces() > RATE_MAX_SCALE) throw new InvalidRateError("A rate has at most 18 decimals");
  if (typeof rate.date !== "string" || !ISO_DATE_RE.test(rate.date)) {
    throw new InvalidRateError("A rate date is YYYY-MM-DD");
  }
  if (typeof rate.source !== "string" || rate.source.trim() === "") {
    throw new InvalidRateError("A rate needs its source");
  }
  if (!isCurrencyCode(rate.base) || !isCurrencyCode(rate.quote)) {
    throw new InvalidRateError("A rate's currencies must be known units");
  }
  if (rate.base === rate.quote)
    throw new InvalidRateError("A rate converts between two different currencies");
}

/**
 * Converts with an explicit dated rate (AGENTS.md «Money»). The result is not rounded to the currency
 * (rounding is for display), only kept at the storage scale of 18 decimals, and range-checked like any amount, so an overflow is a validation error (NFR-06 FR 9).
 * `requestedDate` is the date the amount belongs to; a rate of an earlier date marks the result approximate.
 */
export function convert(amount: Money, rate: ExchangeRate, requestedDate: string): Conversion {
  assertValidRate(rate);
  if (amount.currency !== rate.base)
    throw new InvalidRateError("The rate's base currency must match the amount");
  if (!ISO_DATE_RE.test(requestedDate)) throw new InvalidRateError("The requested date is YYYY-MM-DD");
  if (rate.date > requestedDate)
    throw new InvalidRateError("A rate from after the requested date cannot be used");
  return {
    from: amount,
    // Kept at the storage scale (18 decimals, half to even): far below any display precision.
    to: Money.of(
      amount.amount.times(rate.rate).toDecimalPlaces(AMOUNT_MAX_SCALE, Decimal.ROUND_HALF_EVEN),
      rate.quote,
    ),
    rate: rate.rate,
    rateDate: rate.date,
    source: rate.source,
    requestedDate,
    approximate: rate.date !== requestedDate,
  };
}
