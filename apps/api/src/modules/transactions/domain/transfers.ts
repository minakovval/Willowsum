import type { ExchangeRate, Money } from "@willowsum/domain-kernel";
import type { FieldIssue, TransactionStatus } from "./transactions.ts";

/**
 * A transfer between own accounts (FIN-03@PoC FR 7–9, FR 18, FR 27, edge case 1; wave 2 row 16b), pure: two transactions
 * of the space marked as one movement — a debit on one account and a credit on another. Marked, the pair is neither
 * income nor expense; in one currency the difference is the fee (an expense «Комісії банку», FR 8); in two currencies
 * the actual amounts stay and the difference goes through «Валютна різниця». A side of a transfer is never hidden or
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
  if (transaction.accountId === counterpart.accountId)
    issues.push({ field: "counterpartId", issue: "same_account" });
  if (transaction.amount.isNegative() === counterpart.amount.isNegative())
    issues.push({ field: "counterpartId", issue: "same_direction" });
  if (issues.length > 0) return issues;
  const [outflow, inflow] = transaction.amount.isNegative()
    ? [transaction, counterpart]
    : [counterpart, transaction];
  if (outflow.amount.currency === inflow.amount.currency && inflow.amount.compare(outflow.amount.negated()) > 0)
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

/** The rate a transfer in two currencies keeps (fx-rates): the inflow's currency into the outflow's on its date. */
export function transferRateRequest(
  outflow: { amount: Money; date: string },
  inflow: { amount: Money; date: string },
): { from: string; to: string; date: string } | null {
  if (outflow.amount.currency === inflow.amount.currency) return null;
  return { from: inflow.amount.currency, to: outflow.amount.currency, date: transferDate(outflow, inflow) };
}
