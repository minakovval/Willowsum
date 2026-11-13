/**
 * Currencies of a space and the rate of a date (VAL-04@PoC). Pure rules: no I/O.
 */

/**
 * The reporting currency of a space (FR 2): in this release always EUR, for any locale, with no choice. The
 * attribute itself belongs to the space (household, ACC-06 / ACC-08); this is the value every space has in PoC.
 */
export const REPORTING_CURRENCY = "EUR";

/**
 * Currencies with restricted convertibility (edge case 2): the official rate is used, with the warning «Офіційний
 * курс, ринковий може відрізнятися». Currencies under exchange controls whose official rate commonly differs from
 * the market one. Reference data, not a rule: changing the list is a data change (open owner question in the PR).
 */
export const RESTRICTED_CONVERTIBILITY: ReadonlySet<string> = new Set([
  "ARS",
  "BYN",
  "CUP",
  "ETB",
  "IRR",
  "KPW",
  "LBP",
  "MMK",
  "NGN",
  "RUB",
  "SYP",
  "UZS",
  "VES",
]);

export function isRestrictedConvertibility(currency: string): boolean {
  return RESTRICTED_CONVERTIBILITY.has(currency);
}

export { rateCoversDate } from "@willowsum/domain-kernel";
