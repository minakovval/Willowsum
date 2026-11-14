import { Decimal, isCalendarDate, Money } from "@willowsum/domain-kernel";

/**
 * The interest a deposit has earned, as an estimate (FIN-01@PoC FR 9–11, AC3, edge cases 2 and 3): simple interest on
 * the current balance, actual days / 365, from the opening date to today or to the maturity date if that is earlier.
 * Shown «розрахунково». Pure, with `today` given by the caller (never read here).
 */
export interface DepositTerms {
  /** Percent per year, a decimal string; null — not given. */
  readonly annualRate: string | null;
  readonly openedOn: string | null;
  readonly maturesOn: string | null;
}

export interface DepositAccrual {
  /** The estimate in the account's currency, unrounded (18 decimals); rounded only when shown. */
  readonly accrued: Money;
  /** Days the interest runs: opening date to today or to the maturity date, whichever is earlier. */
  readonly days: number;
  /** Days left to the maturity date; 0 once it has come. */
  readonly daysToMaturity: number;
  /** «Строк закінчився»: today is the maturity date or later. */
  readonly matured: boolean;
}

const DAY_MS = 86_400_000;
/** The storage scale of amounts (domain-kernel `AMOUNT_MAX_SCALE`). */
const SCALE = 18;

/** Whole days from `from` to `to` (ISO calendar dates); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  if (!isCalendarDate(from) || !isCalendarDate(to)) throw new RangeError("Not a calendar date");
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * The accrual of a deposit on `today`, or null when it is not calculated: without a rate, an opening date or a
 * maturity date (edge case 2 — no interest and no reminder).
 */
export function depositAccrual(balance: Money, terms: DepositTerms, today: string): DepositAccrual | null {
  const { annualRate, openedOn, maturesOn } = terms;
  if (annualRate === null || openedOn === null || maturesOn === null) return null;
  const end = today < maturesOn ? today : maturesOn;
  const days = Math.max(0, daysBetween(openedOn, end));
  const accrued = balance.amount
    .times(new Decimal(annualRate))
    .div(100)
    .times(new Decimal(days))
    .div(365)
    .toDecimalPlaces(SCALE, Decimal.ROUND_HALF_EVEN);
  return {
    accrued: Money.of(accrued, balance.currency),
    days,
    daysToMaturity: Math.max(0, daysBetween(today, maturesOn)),
    matured: today >= maturesOn,
  };
}
