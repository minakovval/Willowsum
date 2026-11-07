import { exchangeRate, type ExchangeRate } from "@willowsum/domain-kernel";
import { systemClock, type AdapterClock } from "../../clock.ts";
import { checkRatesRequest, type ExchangeRateSource, type RatesRequest } from "./port.ts";

/** FNV-1a, 32 bits: the same request always gives the same synthetic rate. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Test implementation (ARC-05 FR 2): invented but stable rates, no network. Built from digits, never from a
 * float: a whole part 1–9 and six decimals derived from the currencies and the date. Source «synthetic».
 */
export function syntheticExchangeRates(clock: AdapterClock = systemClock): ExchangeRateSource {
  return {
    async ratesOn(request: RatesRequest): Promise<readonly ExchangeRate[]> {
      checkRatesRequest(request, clock.now());
      return [...new Set(request.quotes)].map((quote) => {
        const h = hash(`${request.base}:${quote}:${request.date}`);
        const digits = `${1 + (h % 9)}.${String(Math.floor(h / 9) % 1_000_000).padStart(6, "0")}`;
        return exchangeRate({
          base: request.base,
          quote,
          rate: digits,
          date: request.date,
          source: "synthetic",
        });
      });
    },
  };
}
