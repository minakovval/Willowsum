import type { ExchangeRate } from "@willowsum/domain-kernel";
import { createLastKnown, type LastKnown, type Observed } from "../../last-known.ts";
import { selectImplementation, type ProviderImplementations, type ProviderMode } from "../../port.ts";
import { httpExchangeRates, type HttpExchangeRatesOptions } from "./http.ts";
import { ratesKey, type ExchangeRateSource, type RatesRequest } from "./port.ts";
import { syntheticExchangeRates } from "./synthetic.ts";

export { EXCHANGE_RATES_PORT, checkRatesRequest, ratesKey } from "./port.ts";
export type { ExchangeRateSource, RatesRequest } from "./port.ts";
export { httpExchangeRates } from "./http.ts";
export type { HttpExchangeRatesOptions } from "./http.ts";
export { syntheticExchangeRates } from "./synthetic.ts";

/** Both implementations of the port (ARC-05 FR 2). */
export const EXCHANGE_RATE_IMPLEMENTATIONS: ProviderImplementations<
  ExchangeRateSource,
  HttpExchangeRatesOptions
> = Object.freeze({ test: syntheticExchangeRates, live: httpExchangeRates });

/** The implementation the configuration selects (`WS_PROVIDER_MODE`; `test` unless set to `live`). */
export function exchangeRateSource(
  mode: ProviderMode,
  liveOptions: () => HttpExchangeRatesOptions,
): ExchangeRateSource {
  return selectImplementation(mode, EXCHANGE_RATE_IMPLEMENTATIONS, liveOptions);
}

/** Reads that survive a provider failure: the last known rates come back with their date (ARC-05 FR 4). */
export interface ObservedExchangeRates {
  ratesOn(request: RatesRequest): Promise<Observed<readonly ExchangeRate[]>>;
}

export function withLastKnownRates(
  source: ExchangeRateSource,
  lastKnown: LastKnown<readonly ExchangeRate[]> = createLastKnown(),
): ObservedExchangeRates {
  return { ratesOn: (request) => lastKnown.read(ratesKey(request), () => source.ratesOn(request)) };
}
