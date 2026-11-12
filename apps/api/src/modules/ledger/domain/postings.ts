import type { Money } from "@willowsum/domain-kernel";
import { DomainError } from "@willowsum/domain-kernel";

/**
 * Posting sets of the double-entry journal (FIN-04@PoC FR 2, ARC-11; ADR-0011). A posting debits one account and
 * credits another by one positive amount; an entry is one or more postings. Amounts are Money (exact decimals).
 */

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** The service accounts of every space (FIN-04 FR 7, ARC-11 «План рахунків»): one per currency, made on first use. */
export const SERVICE_ACCOUNTS = {
  "external-funds": "equity",
  "revaluation-reserve": "equity",
  "fx-difference": "equity",
  adjustment: "equity",
  "realized-gain": "income",
} as const satisfies Record<string, AccountType>;
export type ServiceAccount = keyof typeof SERVICE_ACCOUNTS;

/** A side of a posting: an owner module's ledger account by id, or a service account of the space. */
export type AccountRef = { readonly account: string } | { readonly service: ServiceAccount };

export interface Posting {
  readonly debit: AccountRef;
  readonly credit: AccountRef;
  readonly amount: Money;
}

export class LedgerError extends DomainError {}

/** At most this many postings in one entry (the `seq` range of the postings table). */
export const MAX_POSTINGS = 1000;

export const refKey = (ref: AccountRef): string =>
  "account" in ref ? `a:${ref.account}` : `s:${ref.service}`;

/**
 * The guard before anything is written (FIN-04 FR 2; the code side of the database constraints). A posting carries
 * one amount for both its sides, so an entry is balanced per currency exactly when every posting is valid: at least
 * one posting; every amount positive; the two sides different accounts; and both accounts in the posting's currency
 * (an amount counted in another currency on one side would leave that currency unbalanced).
 */
export function assertBalanced(postings: readonly Posting[], currencyOf: (ref: AccountRef) => string): void {
  if (postings.length === 0)
    throw new LedgerError("EMPTY_POSTING_SET", "An entry needs at least one posting");
  if (postings.length > MAX_POSTINGS)
    throw new LedgerError("TOO_MANY_POSTINGS", `An entry has at most ${MAX_POSTINGS} postings`);
  for (const p of postings) {
    if (!p.amount.amount.isPositive() || p.amount.isZero())
      throw new LedgerError("INVALID_POSTING", "A posting amount must be positive");
    if (refKey(p.debit) === refKey(p.credit))
      throw new LedgerError("INVALID_POSTING", "A posting must debit and credit different accounts");
    if (currencyOf(p.debit) !== p.amount.currency || currencyOf(p.credit) !== p.amount.currency)
      throw new LedgerError("UNBALANCED", "A posting's accounts must both be in the posting's currency");
  }
}

/**
 * The balance of an account from its debit and credit totals, with the sign of its type (FIN-04 FR 6): debits
 * minus credits for assets and expenses, credits minus debits for liabilities, equity and income.
 */
export function naturalBalance(type: AccountType, debits: Money, credits: Money): Money {
  return type === "asset" || type === "expense" ? debits.minus(credits) : credits.minus(debits);
}
