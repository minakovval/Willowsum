import { currencyInfo, Decimal, Money } from "@willowsum/domain-kernel";
import type { Frequency } from "./schedule.ts";
import { addDays, daysBetween } from "./schedule.ts";
import type { ChargeStatus } from "./tracking.ts";
import { WINDOW_DAYS } from "./tracking.ts";

/**
 * BUD-07@PoC FR 7, FR 16, FR 19: the calendar of «Регулярні платежі» — its horizon, the monthly payments of «Кредит»
 * accounts and the counts of a year. No I/O.
 */

/** FR 7: «на 30 днів (горизонт можна збільшити до 366 днів)». */
export const CALENDAR_DAYS = 30;
export const CALENDAR_MAX_DAYS = 366;

/** FR 7 «сума за рік»: how many charges of each frequency a year holds — the yearly figure of a payment. */
export const CHARGES_A_YEAR: Readonly<Record<Frequency, number>> = {
  week: 52,
  "two-weeks": 26,
  month: 12,
  quarter: 4,
  year: 1,
};

/** A payment to a «Кредит» account: an inflow on it (module transactions), its date. */
export interface LoanInflow {
  readonly transactionId: string;
  readonly date: string;
}

/** FR 16: one month's payment of a «Кредит» account, as the calendar shows it. */
export interface LoanCharge {
  readonly accountId: string;
  readonly dueOn: string;
  readonly expected: Money;
  /** `paid` — the month has a payment to the account; else `expected` within the window ± 3 days, then `overdue`. */
  readonly status: Extract<ChargeStatus, "paid" | "expected" | "overdue">;
  readonly overdueDays: number | null;
  /** The month's first payment to the account. */
  readonly transactionId: string | null;
  readonly paidOn: string | null;
}

const lastDayOf = (month: string): number =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

const nextMonth = (month: string): string => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
  return d.toISOString().slice(0, 7);
};

/**
 * FR 16: the monthly payment of a «Кредит» account in each month of `from`–`to`, once a month, on the day of the latest
 * payment to the account (on or before today; a day the month lacks — its last day), or on the 1st without any payment.
 * A month is paid by its first payment to the account. `inflows` — the payments to the account, any order. A loan
 * without a monthly payment («Додайте ставку і платіж») has none: the caller does not ask.
 */
export function loanCharges(
  accountId: string,
  monthlyPayment: Money,
  inflows: readonly LoanInflow[],
  from: string,
  to: string,
  today: string,
  /** The account's opening date (its wallet's balance date): no payment is due before it. */
  openedOn: string | null = null,
): LoanCharge[] {
  const sorted = [...inflows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.transactionId.localeCompare(b.transactionId),
  );
  const latest = [...sorted].reverse().find((p) => p.date <= today);
  const day = latest ? Number(latest.date.slice(8, 10)) : 1;
  const out: LoanCharge[] = [];
  for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = nextMonth(month)) {
    const dueOn = `${month}-${String(Math.min(day, lastDayOf(month))).padStart(2, "0")}`;
    if (dueOn < from || dueOn > to || (openedOn !== null && dueOn < openedOn)) continue;
    const first = sorted.find((p) => p.date.slice(0, 7) === month && p.date <= today);
    const open = addDays(dueOn, WINDOW_DAYS) >= today;
    out.push({
      accountId,
      dueOn,
      expected: monthlyPayment,
      status: first ? "paid" : open ? "expected" : "overdue",
      overdueDays: first || open ? null : daysBetween(dueOn, today),
      transactionId: first?.transactionId ?? null,
      paidOn: first?.date ?? null,
    });
  }
  return out;
}

/**
 * FR 16: of a loan's payment only the interest is spending, by the rule of splitting a loan payment — for the month's
 * first payment, the debt before it × the annual rate ÷ 12, rounded to the cent half to even (owner decision 2026-11-16).
 * `debt` — positive while owed (nothing owed: no interest); `annualRate` — per cent a year, e.g. "4.2".
 */
export function monthlyInterest(debt: Money, annualRate: string): Money {
  const owed = debt.isNegative() ? new Decimal("0") : debt.amount;
  return Money.of(
    owed
      .times(new Decimal(annualRate))
      .div(new Decimal("1200"))
      .toDecimalPlaces(currencyInfo(debt.currency).minorUnits, Decimal.ROUND_HALF_EVEN),
    debt.currency,
  );
}
