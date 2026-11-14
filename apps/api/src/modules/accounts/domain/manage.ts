import { isCalendarDate, type Money } from "@willowsum/domain-kernel";
import { EARLIEST_DATE, openingAmount, openingEventAmount, type AccountKind } from "./accounts.ts";

/**
 * Managing an account (FIN-12@PoC FR 7–9, FR 14, FR 15; FIN-04@PoC FR 10, FR 11), as pure rules. Amounts are shown
 * from the holder's side (a debt negative): a balance-adjustment event of the ledger moves the shown balance by its own
 * signed amount on either ledger type.
 */

/** The one live adjustment of «Оновити залишок» on a currency of an account: its ledger entry, amount and date. */
export interface LiveAdjustment {
  readonly entryId: string;
  /** Signed, from the holder's side: what it added to the shown balance. */
  readonly amount: Money;
  readonly date: string;
}

/** What one «Оновити залишок» (or a statement's recount) does to the adjustment of a currency. */
export type AdjustmentPlan =
  | { readonly kind: "none" }
  | { readonly kind: "post"; readonly amount: Money }
  | { readonly kind: "correct"; readonly entryId: string; readonly amount: Money }
  | { readonly kind: "reverse"; readonly entryId: string };

/**
 * «Оновити залишок» (FIN-12 FR 14): the difference between the balance entered and Willowsum's. A zero difference makes
 * no transaction; with an adjustment already on the currency its amount changes by the difference (at most one per
 * currency), and an amount that comes to zero removes it.
 */
export function balanceUpdatePlan(
  current: Money,
  target: Money,
  live: LiveAdjustment | null,
): AdjustmentPlan {
  const difference = target.minus(current);
  if (difference.isZero()) return { kind: "none" };
  if (!live) return { kind: "post", amount: difference };
  const amount = live.amount.plus(difference);
  return amount.isZero()
    ? { kind: "reverse", entryId: live.entryId }
    : { kind: "correct", entryId: live.entryId, amount };
}

/**
 * The next statement with a closing balance recounts a temporary adjustment (FIN-12 FR 15): the new difference is the
 * bank's balance minus the balance without the adjustment, dated the statement's end; zero removes it. Without an
 * adjustment the statement creates none (FIN-04 FR 11: never without the user's action).
 */
export function statementPlan(
  withoutAdjustment: Money,
  bank: Money,
  live: LiveAdjustment | null,
  statementEnd: string,
): AdjustmentPlan {
  if (!live) return { kind: "none" };
  const amount = bank.minus(withoutAdjustment);
  if (amount.isZero()) return { kind: "reverse", entryId: live.entryId };
  if (amount.equals(live.amount) && live.date === statementEnd) return { kind: "none" };
  return { kind: "correct", entryId: live.entryId, amount };
}

/**
 * «Поточний залишок*» as typed (FIN-12 FR 14, FR 15) → the shown balance, with the rules of the opening balance: not
 * negative except on a current account; a credit card's and a loan's debt typed as a positive amount; at most the
 * currency's minor units. Null when it is not such an amount.
 */
export function typedBalance(kind: AccountKind, amount: string, currency: string): Money | null {
  const typed = openingAmount(kind, amount, currency);
  return typed && openingEventAmount(kind, typed);
}

export type ClosingDateIssue = "invalid" | "before_opening" | "in_future";

/** The closing date (FIN-12 FR 7): a calendar date from the account's opening date to today. */
export function closingDateIssue(closedOn: string, openedOn: string, today: string): ClosingDateIssue | null {
  if (!isCalendarDate(closedOn) || closedOn < EARLIEST_DATE) return "invalid";
  if (closedOn < openedOn) return "before_opening";
  if (closedOn > today) return "in_future";
  return null;
}
