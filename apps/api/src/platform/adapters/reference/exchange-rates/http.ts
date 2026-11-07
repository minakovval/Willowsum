import { exchangeRate, type ExchangeRate } from "@willowsum/domain-kernel";
import { z } from "zod";
import { ProviderError } from "../../errors.ts";
import { createProviderHttp, type FetchFn } from "../../http.ts";
import { createProviderClient, type ProviderClientOptions } from "../../provider-client.ts";
import {
  EXCHANGE_RATES_PORT,
  checkRatesRequest,
  type ExchangeRateSource,
  type RatesRequest,
} from "./port.ts";

/**
 * Working implementation over HTTP, without a provider SDK (ADR-0005). Unused until the owner chooses a rates
 * provider: the fx-rates module (VAL-05) adds the real provider adapters. It expects
 * `GET <baseUrl>/rates?base=EUR&symbols=USD,UAH&date=YYYY-MM-DD` →
 * `{ "base": "EUR", "date": "YYYY-MM-DD", "rates": { "USD": "1.0812" } }` with rates as decimal strings (a JSON
 * number would already be a float).
 */
export interface HttpExchangeRatesOptions {
  readonly baseUrl: string;
  /** Recorded as each rate's `source`. */
  readonly source: string;
  readonly fetch?: FetchFn;
  readonly headers?: Readonly<Record<string, string>>;
  readonly clock?: ProviderClientOptions["clock"];
  readonly random?: ProviderClientOptions["random"];
  readonly policy?: ProviderClientOptions["policy"];
}

const DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;
const answer = z.object({
  base: z.string(),
  date: z.string(),
  rates: z.record(z.string(), z.string().regex(DECIMAL)),
});

export function httpExchangeRates(options: HttpExchangeRatesOptions): ExchangeRateSource {
  const provider = "exchange-rates:http";
  const client = createProviderClient({
    provider,
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.random ? { random: options.random } : {}),
    ...(options.policy ? { policy: options.policy } : {}),
  });
  const http = createProviderHttp({
    baseUrl: options.baseUrl,
    client,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
  const op = EXCHANGE_RATES_PORT.operations.ratesOn;
  return {
    async ratesOn(request: RatesRequest): Promise<readonly ExchangeRate[]> {
      checkRatesRequest(request);
      const quotes = [...new Set(request.quotes)];
      const body = await http.getJson(op, "rates", {
        base: request.base,
        symbols: quotes.join(","),
        date: request.date,
      });
      const parsed = answer.safeParse(body);
      // A rate of a later date than asked is never used (NFR-06); a missing quote is a broken answer.
      if (
        !parsed.success ||
        parsed.data.base !== request.base ||
        !/^\d{4}-\d{2}-\d{2}$/.test(parsed.data.date) ||
        parsed.data.date > request.date ||
        quotes.some((q) => parsed.data.rates[q] === undefined)
      )
        throw new ProviderError("invalid-response", provider, op.name);
      try {
        return quotes.map((quote) =>
          exchangeRate({
            base: request.base,
            quote,
            rate: parsed.data.rates[quote]!,
            date: parsed.data.date,
            source: options.source,
          }),
        );
      } catch {
        throw new ProviderError("invalid-response", provider, op.name);
      }
    },
  };
}
