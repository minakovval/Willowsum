import { Decimal } from "@willowsum/domain-kernel";
import type { PivotRate } from "../../domain/index.ts";
import type { FxRateFeed } from "../../application/index.ts";

/** Currencies of the synthetic feed: the ones a family in Ukraine holds most often. */
export const SYNTHETIC_CURRENCIES = ["USD", "EUR", "PLN", "GBP", "CHF", "CZK", "JPY", "XAU"] as const;

/** FNV-1a, 32 bits: the same currency and date always give the same synthetic rate. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Test implementation (ARC-05 FR 2): invented but stable official rates, no network; the default locally and in
 * CI (`WS_PROVIDER_MODE=test`). Built from digits, never from a float: 10–99 UAH with four decimals. Source
 * «synthetic», so a synthetic rate is never mistaken for an official one.
 */
export function syntheticRateFeed(): FxRateFeed {
  return {
    name: "synthetic",
    async dailyRates(date): Promise<readonly PivotRate[]> {
      return SYNTHETIC_CURRENCIES.map((currency) => {
        const h = hash(`${currency}:${date}`);
        const digits = `${10 + (h % 90)}.${String(Math.floor(h / 90) % 10_000).padStart(4, "0")}`;
        return { currency, rate: new Decimal(digits), date, source: "synthetic" };
      });
    },
  };
}
