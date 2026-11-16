import { currencyInfo, Decimal } from "@willowsum/domain-kernel";

/**
 * BUD-13@PoC FR 6, FR 7 for «Розділити транзакцію» (S-049), pure. Amounts in the dialog are magnitudes (the board
 * shows «64,00 €» for an expense); the request carries the transaction's sign. The months schedule follows the
 * server's rule (transactions/domain/splits.ts): equal shares towards zero to the minor unit, the remainder in the last.
 */
export const PARTS_MIN = 2;
export const PARTS_MAX = 20;
export const MONTHS_MIN = 2;
export const MONTHS_MAX = 60;

export const minorUnits = (currency: string): number => currencyInfo(currency).minorUnits;

/** «YYYY-MM» `k` months after `start`. */
export function monthAfter(start: string, k: number): string {
  const [y, m] = start.split("-").map((x) => Number.parseInt(x, 10));
  const index = (y ?? 1970) * 12 + ((m ?? 1) - 1) + k;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export interface MonthShare {
  readonly index: number;
  readonly month: string;
  readonly amount: Decimal;
}

/** FR 6, AC5, AC8: the shares of `magnitude` over `months`; null if a share would be 0. */
export function monthShares(
  magnitude: Decimal,
  currency: string,
  start: string,
  months: number,
): MonthShare[] | null {
  const share = magnitude.div(months).toDecimalPlaces(minorUnits(currency), Decimal.ROUND_DOWN);
  if (share.isZero()) return null;
  const last = magnitude.minus(share.mul(months - 1));
  return Array.from({ length: months }, (_, k) => ({
    index: k + 1,
    month: monthAfter(start, k),
    amount: k === months - 1 ? last : share,
  }));
}

/**
 * FR 6: «залишок від округлення додається до першої частини». Each part is rounded to the minor unit; when the exact
 * values make the whole amount and only rounding stops the sum, the difference goes to the first part.
 */
export function roundParts(values: readonly Decimal[], total: Decimal, currency: string): Decimal[] {
  const minor = minorUnits(currency);
  const rounded = values.map((v) => v.toDecimalPlaces(minor, Decimal.ROUND_HALF_UP));
  const exact = values.reduce((s, v) => s.plus(v), new Decimal("0"));
  const unit = new Decimal("1").div(new Decimal("10").pow(minor));
  if (rounded.length === 0 || exact.minus(total).abs().gte(unit.div(2))) return rounded;
  const diff = total.minus(rounded.reduce((s, v) => s.plus(v), new Decimal("0")));
  return rounded.map((v, i) => (i === 0 ? v.plus(diff) : v));
}

/** The text an amount field shows after «=»: «35,00» (uk), «35.00» (en). */
export function fieldText(value: Decimal, currency: string, decimalComma: boolean): string {
  const fixed = value.toFixed(minorUnits(currency));
  return decimalComma ? fixed.replace(".", ",") : fixed;
}
