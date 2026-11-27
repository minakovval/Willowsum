import {
  convert,
  currencyInfo,
  Decimal,
  DomainError,
  Money,
  type ExchangeRate,
} from "@willowsum/domain-kernel";
import type { FieldIssue, TransactionStatus } from "./transactions.ts";

/**
 * A transfer between own accounts (FIN-03@PoC FR 7–9, FR 18, FR 27, edge case 1; wave 2 row 16b), pure: two transactions
 * of the space marked as one movement — a debit on one account and a credit on another. Marked, the pair is neither
 * income nor expense; in one currency the difference is the fee (an expense «Комісії банку», FR 8); in two currencies
 * the actual amounts stay, the journal posts the difference through «Валютна різниця», and the budget counts the
 * difference against the official rate of the date as a loss or a gain in «Комісії банку» (FR 8, owner 2026-11-26,
 * decision 11; `transferDifference`). A side of a transfer is never hidden or
 * split (FR 18, BUD-01 FR 6), and its account, amount, date and state stay as they are until the mark is removed (FR 9).
 */

export interface TransferLink {
  readonly id: string;
  readonly outflowId: string;
  readonly inflowId: string;
  /**
   * Two currencies: 1 unit of the inflow's currency = `rate` units of the outflow's (the journal's `fx-transfer`), the
   * official rate of the transfer's date or the nearest earlier one, kept when marked; null in one currency.
   */
  readonly rate: ExchangeRate | null;
  /**
   * IMP-03@PoC FR 21: the category the budget counts the fee (one currency) or the currency difference (two) in, chosen
   * with «Змінити категорію»; null or absent — the space's «Комісії банку».
   */
  readonly feeCategoryId?: string | null;
}

export interface PairSide {
  readonly id: string;
  readonly accountId: string;
  readonly amount: Money;
  readonly date: string;
  readonly status: TransactionStatus;
  readonly hidden: boolean;
  readonly split: unknown;
  readonly transfer: TransferLink | null;
}

/**
 * «Позначити як переказ» (FR 27) or «Підтвердити» of a proposal (FR 6): which side is the outflow, or what stops the
 * pair. `transactionId` is the transaction the action is on, `counterpartId` the other. In one currency the credit may
 * not exceed the debit: the difference is a fee, never a gain. The user's own choice needs no tolerance of FR 5.
 */
export function orderPair<T extends PairSide>(
  transaction: T,
  counterpart: T,
): { readonly outflow: T; readonly inflow: T } | FieldIssue[] {
  if (transaction.id === counterpart.id) return [{ field: "counterpartId", issue: "invalid" }];
  const issues: FieldIssue[] = [];
  for (const [field, side] of [
    ["transactionId", transaction],
    ["counterpartId", counterpart],
  ] as const) {
    if (side.status !== "posted") issues.push({ field, issue: "pending" });
    if (side.hidden) issues.push({ field, issue: "hidden" });
    if (side.split !== null) issues.push({ field, issue: "split" });
    if (side.transfer !== null) issues.push({ field, issue: "in_transfer" });
  }
  // IMP-03@PoC FR 2: two wallets of one account in two currencies are an exchange; one wallet is no pair.
  if (
    transaction.accountId === counterpart.accountId &&
    transaction.amount.currency === counterpart.amount.currency
  )
    issues.push({ field: "counterpartId", issue: "same_account" });
  if (transaction.amount.isNegative() === counterpart.amount.isNegative())
    issues.push({ field: "counterpartId", issue: "same_direction" });
  if (issues.length > 0) return issues;
  const [outflow, inflow] = transaction.amount.isNegative()
    ? [transaction, counterpart]
    : [counterpart, transaction];
  if (
    outflow.amount.currency === inflow.amount.currency &&
    inflow.amount.compare(outflow.amount.negated()) > 0
  )
    return [{ field: "counterpartId", issue: "amount_mismatch" }];
  return { outflow, inflow };
}

/** Edge case 1: a transfer is dated by its earlier side. */
export function transferDate(outflow: { date: string }, inflow: { date: string }): string {
  return outflow.date < inflow.date ? outflow.date : inflow.date;
}

/** FR 8: in one currency the fee (negative) — debit plus credit; zero or two currencies: none. */
export function transferFee(outflow: { amount: Money }, inflow: { amount: Money }): Money | null {
  if (outflow.amount.currency !== inflow.amount.currency) return null;
  const fee = outflow.amount.plus(inflow.amount);
  return fee.isZero() ? null : fee;
}

/**
 * FR 8 (owner, 2026-11-26, decision 11; IMP-03 FR 9, FR 21): what the budget counts of a marked transfer in
 * «Комісії банку» — in one currency the fee (`transferFee`, negative, in the debit's currency, on the debit's account);
 * in two currencies the credit actually received less the debit at the kept official rate of the date, rounded half to
 * even to the credit currency's minor units (as a stored amount): negative — a loss (an expense), positive — a gain
 * (an income), in the credit's currency, on the credit's account. Zero, no kept rate, or past a stored amount — none.
 * `rate`: 1 unit of the credit's currency in the debit's (`TransferLink.rate`).
 */
export function transferDifference(
  outflow: { amount: Money },
  inflow: { amount: Money },
  rate: ExchangeRate | null,
): { readonly amount: Money; readonly side: "outflow" | "inflow" } | null {
  if (outflow.amount.currency === inflow.amount.currency) {
    const fee = transferFee(outflow, inflow);
    return fee === null ? null : { amount: fee, side: "outflow" };
  }
  if (rate === null || rate.rate.isZero()) return null;
  const currency = inflow.amount.currency;
  try {
    const minor = currencyInfo(currency).minorUnits;
    // Рішення ведучого (2026-11-26; власник не схвалював; #728): the difference is measured against the official
    // conversion rounded half to even to the credit currency's minor units, so a credit the server converted at the
    // official rate has no difference. The official rate is the short one: the kept rate itself, or — when the kept rate
    // is the 18-decimal reciprocal of a short forward rate (fx-rates) — that forward rate, as `transferReceived` uses it.
    const debit = outflow.amount.amount.negated();
    const forward = new Decimal("1").div(rate.rate).toSignificantDigits(15);
    const official = new Decimal("1").div(forward).toDecimalPlaces(18, Decimal.ROUND_HALF_EVEN).eq(rate.rate)
      ? debit.times(forward)
      : debit.div(rate.rate);
    const atRate = official.toDecimalPlaces(minor, Decimal.ROUND_HALF_EVEN);
    const difference = inflow.amount.minus(Money.of(atRate, currency));
    return difference.isZero() ? null : { amount: difference, side: "inflow" };
  } catch (error) {
    if (error instanceof DomainError && error.code === "AMOUNT_OUT_OF_RANGE") return null;
    throw error;
  }
}

/** The rate a transfer in two currencies keeps (fx-rates): the inflow's currency into the outflow's on its date. */
export function transferRateRequest(
  outflow: { amount: Money; date: string },
  inflow: { amount: Money; date: string },
): { from: string; to: string; date: string } | null {
  if (outflow.amount.currency === inflow.amount.currency) return null;
  return { from: inflow.amount.currency, to: outflow.amount.currency, date: transferDate(outflow, inflow) };
}

/**
 * «Переказ між рахунками» of the form «Нова транзакція» (FIN-03@PoC FR 1, FR 28; issue #437): the credit of a transfer
 * created in one action from `sent` — the positive «Сума» in the currency of the account it leaves. `given` is the
 * credit the user entered, in the currency of the account it reaches: in one currency at most `sent` (the difference is
 * the fee, FR 8), in two currencies any positive amount (the actual amounts stay, FR 8). Without it: in one currency
 * `sent` itself; in two currencies `sent` at `forward` — the official rate of the date, 1 unit of the debit's currency
 * in the credit's (VAL-04 FR 4) — rounded half to even to the credit currency's minor units, as a stored amount is
 * (owner, 2026-11-16, #419: half to even in calculations and storage). Null `forward` in two currencies: no rate.
 */
export function transferReceived(
  sent: Money,
  currency: string,
  given: Money | null,
  forward: ExchangeRate | null,
  date: string,
): Money | FieldIssue | "rate_unavailable" {
  if (given !== null) {
    if (given.currency === sent.currency && given.compare(sent) > 0)
      return { field: "received", issue: "amount_mismatch" };
    return given;
  }
  if (currency === sent.currency) return sent;
  if (forward === null) return "rate_unavailable";
  let received: Money;
  try {
    const converted = convert(sent, forward, date).to;
    received = Money.of(
      converted.amount.toDecimalPlaces(currencyInfo(currency).minorUnits, Decimal.ROUND_HALF_EVEN),
      currency,
    );
  } catch (error) {
    // The converted credit does not fit a stored amount (NUMERIC(38,18)): a field issue, never a 500.
    if (error instanceof DomainError && error.code === "AMOUNT_OUT_OF_RANGE")
      return { field: "amount", issue: "invalid" };
    throw error;
  }
  // Too small to reach the credit currency's minor unit: a transfer moves money (FR 2).
  return received.isZero() ? { field: "amount", issue: "zero" } : received;
}

/**
 * Whether the journal can keep a two-currency transfer's credit: it posts the credit converted into the debit's
 * currency at the kept rate (fx-transfer, ARC-11), and a value beyond a stored amount (NUMERIC(38,18)) never posts.
 */
export function creditFitsJournal(received: Money, rate: ExchangeRate, date: string): boolean {
  try {
    convert(received, rate, date);
    return true;
  } catch (error) {
    if (error instanceof DomainError && error.code === "AMOUNT_OUT_OF_RANGE") return false;
    throw error;
  }
}
