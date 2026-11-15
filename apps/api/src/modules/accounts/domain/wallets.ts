import { isCalendarDate, isCurrencyCode } from "@willowsum/domain-kernel";
import {
  CURRENCIES_MAX,
  EARLIEST_DATE,
  openingAmount,
  type AccountKind,
  type FieldIssue,
  type OpeningBalance,
} from "./accounts.ts";

/**
 * The currencies (wallets) of an existing account (IMP-02@PoC FR 1, FR 15; FIN-01@PoC FR 12; FIN-12@PoC FR 4): a
 * multi-currency account is a container with a subaccount per currency. «+ додати ще валюту» in «Основне» adds one with
 * its opening balance and date, as the form of a new account does; a currency without transactions can be removed, one
 * with transactions cannot, and the main currency (position 0, the account's own) stays. Pure rules; the application
 * checks the transactions in the journal.
 */

/** What «+ додати ще валюту» sends: «Валюта», «Залишок» and «На дату». */
export interface AddedCurrencyInput {
  readonly currency: string;
  readonly amount: string;
  readonly date: string;
}

/**
 * Checks a currency added to an account: only a current account has several currencies (FIN-01 FR 12); a code, not one
 * the account has, at most `CURRENCIES_MAX` in all; the balance as for a new account; the date a calendar date not
 * before the account's opening (the owners' shares run from it, FIN-01 FR 6) and not after today.
 */
export function checkAddedCurrency(
  account: { readonly kind: AccountKind; readonly openedOn: string },
  existing: readonly string[],
  input: AddedCurrencyInput,
  today: string,
): { readonly opening: OpeningBalance } | { readonly issues: readonly FieldIssue[] } {
  if (account.kind !== "current") return { issues: [{ field: "currency", issue: "not_multi_currency" }] };
  const issues: FieldIssue[] = [];
  if (!isCurrencyCode(input.currency)) issues.push({ field: "currency", issue: "invalid" });
  else if (existing.includes(input.currency)) issues.push({ field: "currency", issue: "duplicate" });
  else if (existing.length + 1 > CURRENCIES_MAX) issues.push({ field: "currency", issue: "too_many" });
  const balance = isCurrencyCode(input.currency)
    ? openingAmount(account.kind, input.amount, input.currency)
    : null;
  // The balance is checked in the currency's minor units, so only for a currency code.
  if (!balance && isCurrencyCode(input.currency)) issues.push({ field: "balance", issue: "invalid" });
  const dateIssue =
    !isCalendarDate(input.date) || input.date < EARLIEST_DATE
      ? "invalid"
      : input.date < account.openedOn
        ? "before_opening"
        : input.date > today
          ? "date_in_future"
          : null;
  if (dateIssue) issues.push({ field: "date", issue: dateIssue });
  if (issues.length > 0 || !balance) return { issues };
  return { opening: { balance, date: input.date } };
}

/** The first free position of a new subaccount (positions 0–9, one per currency; a removed one is free again). */
export function freePosition(taken: readonly number[]): number | null {
  for (let p = 0; p < CURRENCIES_MAX; p++) if (!taken.includes(p)) return p;
  return null;
}

/** Why a currency of an account cannot be removed, or null when it can (IMP-02 FR 15, AC14). */
export type RemovalIssue = "main_currency" | "has_transactions";

/**
 * A currency can be removed when it is not the account's main one (position 0) and its wallet has no transactions:
 * no ledger entry in effect besides «Початковий залишок» (an adjustment of «Оновити залишок» is one, FIN-12 FR 14).
 */
export function removalIssue(position: number, hasTransactions: boolean): RemovalIssue | null {
  if (position === 0) return "main_currency";
  return hasTransactions ? "has_transactions" : null;
}
