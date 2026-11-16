import {
  currencyInfo,
  Decimal,
  DomainError,
  isCalendarDate,
  isCurrencyCode,
  Money,
} from "@willowsum/domain-kernel";
import { FIXED_TOLERANCE } from "./detect.ts";
import { addDays, FREQUENCIES, scheduleDate, type Frequency } from "./schedule.ts";

/**
 * A regular payment of the space and the user's decisions on the proposals (BUD-07@PoC FR 2, FR 4, FR 6; wave 2 row 25
 * — part a2): the fields of a payment added by hand or confirmed with edits, the freshness of a found series, and
 * whether a proposal is a series the user called «Не регулярний». Pure rules, no I/O; every amount is Money.
 */

export const PAYMENT_TYPES = ["expense", "income"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];
export const NAME_MAX = 60;
/** FR 2: the days after one interval of the series that its latest charge may be old by. */
export const FRESH_GRACE_DAYS = 3;

const AMOUNT_RE = /^\d{1,20}(?:\.\d{1,18})?$/;

export interface PaymentIssue {
  readonly field: string;
  readonly issue: string;
}

/**
 * FR 2 (owner, 2026-11-16): a series is proposed only while its latest charge is no older than one interval of the
 * series + 3 days before today — a week 7 days, 2 weeks 14 days, a month, a quarter and a year 1, 3 and 12 calendar
 * months from that charge (charged on 10 September — proposed until 13 October inclusive).
 */
export function isFresh(lastDate: string, frequency: Frequency, today: string): boolean {
  return addDays(scheduleDate(lastDate, frequency, 1), FRESH_GRACE_DAYS) >= today;
}

/** A positive amount as typed, with at most the currency's minor units; null when it is not one. */
export function parsePositiveAmount(text: string, currency: string): Money | null {
  if (!AMOUNT_RE.test(text) || !isCurrencyCode(currency)) return null;
  const amount = new Decimal(text);
  if (amount.isZero() || amount.decimalPlaces() > currencyInfo(currency).minorUnits) return null;
  try {
    return Money.of(amount, currency);
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
}

/** FR 6: a payment as «Додати вручну» or a confirmation with edits sends it. */
export interface PaymentInput {
  readonly name: string;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly frequency: Frequency;
  readonly anchorDate: string;
  readonly categoryId?: string | null | undefined;
  readonly accountId?: string | null | undefined;
  readonly endDate?: string | null | undefined;
  readonly type: PaymentType;
  readonly subscription?: boolean | undefined;
  readonly variable?: boolean | undefined;
}

/** A payment's fields, checked (FR 6). */
export interface PaymentFields {
  readonly name: string;
  readonly expected: Money;
  readonly frequency: Frequency;
  /** «Дата прив'язки»: the schedule is counted from it (months: a day the month lacks is its last day). */
  readonly anchorDate: string;
  readonly categoryId: string | null;
  readonly accountId: string | null;
  readonly endDate: string | null;
  readonly type: PaymentType;
  readonly subscription: boolean;
  readonly variable: boolean;
}

/** FR 6: name 1–60 characters on one line, a positive amount, a frequency, a date and an end not before it. */
export function checkPayment(
  input: PaymentInput,
):
  | { readonly kind: "ok"; readonly fields: PaymentFields }
  | { readonly kind: "invalid"; readonly issues: PaymentIssue[] } {
  const issues: PaymentIssue[] = [];
  const name = input.name.trim();
  if (name.length === 0) issues.push({ field: "name", issue: "required" });
  else if ([...name].length > NAME_MAX || /[\r\n]/.test(name))
    issues.push({ field: "name", issue: "too_long" });
  const expected = parsePositiveAmount(input.amount.amount, input.amount.currency);
  if (expected === null) issues.push({ field: "amount", issue: "invalid" });
  if (!FREQUENCIES.includes(input.frequency)) issues.push({ field: "frequency", issue: "invalid" });
  if (!isCalendarDate(input.anchorDate)) issues.push({ field: "anchorDate", issue: "invalid" });
  const endDate = input.endDate ?? null;
  if (endDate !== null) {
    if (!isCalendarDate(endDate)) issues.push({ field: "endDate", issue: "invalid" });
    else if (isCalendarDate(input.anchorDate) && endDate < input.anchorDate)
      issues.push({ field: "endDate", issue: "before_anchor" });
  }
  if (issues.length > 0 || expected === null) return { kind: "invalid", issues };
  return {
    kind: "ok",
    fields: {
      name,
      expected,
      frequency: input.frequency,
      anchorDate: input.anchorDate,
      categoryId: input.categoryId ?? null,
      accountId: input.accountId ?? null,
      endDate,
      type: input.type,
      subscription: input.subscription ?? false,
      variable: input.variable ?? false,
    },
  };
}

/** A series the user called «Не регулярний» (FR 4), as stored. */
export interface RejectedSeries {
  readonly merchantId: string;
  readonly type: PaymentType;
  readonly frequency: Frequency;
  readonly variable: boolean;
  readonly expected: Money;
  readonly transactionIds: readonly string[];
}

/** A found series as the match reads it. */
export interface FoundSeries {
  readonly merchantId: string;
  readonly type: PaymentType;
  readonly frequency: Frequency;
  readonly variable: boolean;
  readonly expected: Money;
  readonly transactionIds: readonly string[];
}

/**
 * FR 4 «після відхилення ця серія більше не пропонується» (#315, п. 8): not by the proposal's key alone, which holds the
 * series' first charge and changes once that charge leaves the 430 days. The same merchant, type, currency and
 * frequency, and either a charge in common with the rejected series, or the same kind of amount — both variable, or
 * both fixed with the amount within ± 10 % of the rejected one (another price of the same merchant is another series,
 * FR 3).
 */
export function isRejected(series: FoundSeries, rejected: RejectedSeries): boolean {
  if (
    series.merchantId !== rejected.merchantId ||
    series.type !== rejected.type ||
    series.frequency !== rejected.frequency ||
    series.expected.currency !== rejected.expected.currency
  )
    return false;
  const charges = new Set(rejected.transactionIds);
  if (series.transactionIds.some((id) => charges.has(id))) return true;
  if (series.variable !== rejected.variable) return false;
  if (series.variable) return true;
  const base = rejected.expected.amount;
  return (
    series.expected.amount.greaterThanOrEqualTo(base.times(FIXED_TOLERANCE.low)) &&
    series.expected.amount.lessThanOrEqualTo(base.times(FIXED_TOLERANCE.high))
  );
}
