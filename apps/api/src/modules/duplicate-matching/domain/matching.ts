import type { Money } from "@willowsum/domain-kernel";

/**
 * The rule of duplicates of a transaction (FIN-03@PoC FR 10, FR 12, AC6; IMP-04@PoC FR 5; wave 2 row 16c), pure.
 * «Можливий дубль» (FR 12): two transactions on the same account with the same amount and currency, dated within 3 days
 * of each other. The mark never deletes or hides anything by itself: the user chooses «Об'єднати» or «Не дубль».
 * An imported (bank) transaction is merged with a manual one automatically only with high confidence (FR 10): the rule
 * above, the manual one not matched with anything yet, and it the only candidate — otherwise it goes to «До розбору»
 * as «Можливий дубль».
 */

export const MATCH_WINDOW_DAYS = 3;

/** What the transactions module's search takes (its SQL narrows by it; the rule below decides). */
export const candidateQuery = { windowDays: MATCH_WINDOW_DAYS } as const;

export interface DuplicateSide {
  readonly transactionId: string;
  readonly accountId: string;
  /** Signed, in the account's currency. */
  readonly amount: Money;
  readonly date: string;
}

export interface DuplicatePair {
  /** The earlier of the two (then the smaller id). */
  readonly first: DuplicateSide;
  readonly second: DuplicateSide;
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** FR 12: the same account, the same amount and currency, dates within 3 days; never a transaction with itself. */
export function isPossibleDuplicate(a: DuplicateSide, b: DuplicateSide): boolean {
  return (
    a.transactionId !== b.transactionId &&
    a.accountId === b.accountId &&
    a.amount.equals(b.amount) &&
    Math.abs(dayNumber(a.date) - dayNumber(b.date)) <= MATCH_WINDOW_DAYS
  );
}

/** A transaction already in the space that an incoming one may duplicate. */
export interface ExistingTransaction extends DuplicateSide {
  readonly source: "manual" | "imported";
  /** FR 10: «ще ні з чим не зіставлена» — not merged with an imported transaction yet. */
  readonly matched: boolean;
}

export type IncomingDecision =
  /** FR 10, FR 11: high confidence — merged with this manual transaction. */
  | { readonly kind: "merge"; readonly with: ExistingTransaction }
  /** FR 12, AC6: below it — «До розбору» with «Можливий дубль»; nothing merged, deleted or hidden. */
  | { readonly kind: "possible-duplicate"; readonly candidates: readonly ExistingTransaction[] }
  /** No duplicate: a new transaction. */
  | { readonly kind: "new" };

/**
 * FR 10 for an imported (bank) transaction against the space's transactions: merged automatically only when exactly one
 * transaction matches by FR 12, it is manual and not matched yet; any other match — «Можливий дубль».
 */
export function decideIncoming(
  incoming: DuplicateSide,
  existing: readonly ExistingTransaction[],
): IncomingDecision {
  const candidates = existing.filter((t) => isPossibleDuplicate(incoming, t));
  if (candidates.length === 0) return { kind: "new" };
  const [only] = candidates;
  if (candidates.length === 1 && only && only.source === "manual" && !only.matched)
    return { kind: "merge", with: only };
  return { kind: "possible-duplicate", candidates };
}
