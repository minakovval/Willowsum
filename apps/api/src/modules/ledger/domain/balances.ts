import { Money } from "@willowsum/domain-kernel";

/**
 * The daily balance cache (ARC-11 «Баланси і продуктивність»): what one entry adds to each account it touches. The
 * cache keeps, per account and day, the debit and credit totals of every posting dated up to that day; an entry adds
 * its movements to the row of its operation date and to every later row of the account (a back-dated entry too).
 */

export interface PostingSides {
  readonly debitAccountId: string;
  readonly creditAccountId: string;
  readonly amount: Money;
}

export interface BalanceMovement {
  readonly accountId: string;
  readonly debits: Money;
  readonly credits: Money;
}

/**
 * The debit and credit totals an entry's postings add to each of its accounts, in the order of the account ids: the
 * cache rows of several accounts are always locked in this one order, so two entries never wait on each other.
 */
export function balanceMovements(postings: readonly PostingSides[]): BalanceMovement[] {
  const byAccount = new Map<string, { debits: Money; credits: Money }>();
  const of = (accountId: string, currency: string) => {
    let m = byAccount.get(accountId);
    if (!m) {
      m = { debits: Money.zero(currency), credits: Money.zero(currency) };
      byAccount.set(accountId, m);
    }
    return m;
  };
  for (const p of postings) {
    const debit = of(p.debitAccountId, p.amount.currency);
    debit.debits = debit.debits.plus(p.amount);
    const credit = of(p.creditAccountId, p.amount.currency);
    credit.credits = credit.credits.plus(p.amount);
  }
  return [...byAccount.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([accountId, m]) => ({ accountId, ...m }));
}
