import { isCurrencyCode, type ExchangeRate } from "@willowsum/domain-kernel";
import { defineProviderPort } from "../../port.ts";

/**
 * Reference port of the adapter kit (ARC-05, ADR-0005): exchange rates. It proves the kit end to end — a
 * synthetic implementation for local development and CI, a working implementation over HTTP, declared
 * outgoing fields, the last known value. The fx-rates module (VAL-05) takes it over with its own provider
 * adapters; until then nothing in the running API uses it.
 */
export const EXCHANGE_RATES_PORT = defineProviderPort("exchange-rates", {
  // A read: safe to repeat. Sends only the currency codes and the date — nothing about the household.
  ratesOn: { idempotent: true, fields: ["base", "symbols", "date"] },
});

export interface RatesRequest {
  /** Currency the rates are quoted against: 1 `base` = rate × `quote`. */
  readonly base: string;
  readonly quotes: readonly string[];
  /** YYYY-MM-DD: the rate of this date, or the latest published before it. */
  readonly date: string;
}

export interface ExchangeRateSource {
  /** Dated rates (Decimal, never floats) from `base` to each of `quotes`; never of a later date. */
  ratesOn(request: RatesRequest): Promise<readonly ExchangeRate[]>;
}

const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function checkRatesRequest(request: RatesRequest): void {
  if (!isCurrencyCode(request.base)) throw new Error("Unknown base currency");
  if (request.quotes.length === 0) throw new Error("At least one quote currency");
  for (const q of request.quotes) {
    if (!isCurrencyCode(q) || q === request.base) throw new Error("Invalid quote currency");
  }
  if (!ISO_DATE_RE.test(request.date)) throw new Error("A rates date is YYYY-MM-DD");
}

/** Key of a request for the last known value: the same currencies and date, in any order. */
export function ratesKey(request: RatesRequest): string {
  return `${request.base}:${[...new Set(request.quotes)].sort().join(",")}:${request.date}`;
}
