import { Decimal, RATE_MAX_SCALE, exchangeRate, type ExchangeRate } from "@willowsum/domain-kernel";

/**
 * The directory of currency replacements (ACC-06@PoC business rules, edge case 2): from its changeover date a
 * withdrawn currency is converted to its successor at the official fixed conversion rate, never at a market or
 * cross rate. Reference data, not a rule: a new replacement is a data change.
 */
export interface FixedConversion {
  /** The withdrawn currency. */
  readonly currency: string;
  /** The currency that replaced it. */
  readonly successor: string;
  /** Units of `currency` per 1 unit of `successor` (how the official rate is published: 1 EUR = 1.95583 BGN). */
  readonly unitsPerSuccessor: string;
  /** The first day (YYYY-MM-DD) the successor replaced the currency. */
  readonly since: string;
}

/** The source recorded with a fixed conversion (the Council of the EU sets the euro conversion rates). */
export const FIXED_CONVERSION_SOURCE = "EU";

/**
 * Only units the domain kernel accepts can be listed (NFR-06: HRK, withdrawn in 2023, is not a unit an amount can
 * be held in, so its fixed rate 7.53450 has no row until the kernel accepts it; open owner question of the PR).
 * BGN → EUR: the irrevocably fixed rate set by the Council of the EU (July 2025), from 2026-01-01.
 */
export const FIXED_CONVERSIONS: readonly FixedConversion[] = [
  { currency: "BGN", successor: "EUR", unitsPerSuccessor: "1.95583", since: "2026-01-01" },
];

/**
 * The fixed rate `from` → `to` on `date`, or null when the directory has none for that pair and date (the ordinary
 * official rate then applies; before the changeover a withdrawn currency has its market rate). The rate is the
 * rate of `date` itself — it is fixed for every day from the changeover — so a conversion with it is never
 * «приблизно». Successor → currency is the published rate exactly; currency → successor is its reciprocal at the
 * 18 decimals a rate may have (NFR-06), an error below 10^-18 per unit, far under any display precision.
 */
export function fixedConversionRate(
  from: string,
  to: string,
  date: string,
  directory: readonly FixedConversion[] = FIXED_CONVERSIONS,
): ExchangeRate | null {
  for (const entry of directory) {
    if (date < entry.since) continue;
    const units = new Decimal(entry.unitsPerSuccessor);
    let rate: Decimal | null = null;
    if (from === entry.currency && to === entry.successor)
      rate = new Decimal("1").dividedBy(units).toDecimalPlaces(RATE_MAX_SCALE, Decimal.ROUND_HALF_EVEN);
    else if (from === entry.successor && to === entry.currency) rate = units;
    if (rate) return exchangeRate({ base: from, quote: to, rate, date, source: FIXED_CONVERSION_SOURCE });
  }
  return null;
}
