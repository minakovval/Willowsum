import type { Money } from "@willowsum/domain-kernel";
import type { FieldIssue } from "./transactions.ts";
import type { TransferLink } from "./transfers.ts";

/**
 * Duplicates of a transaction (FIN-03@PoC FR 11, FR 12, FR 18, FR 27, edge case 4; wave 2 row 16c), pure. «Об'єднати»
 * (a «Можливий дубль» or «Об'єднати з іншою») merges the duplicate into the transaction that stays: the duplicate is
 * hidden — hiding is for duplicates (FR 18) — and loses its own journal event, so the operation counts once; the one
 * that stays keeps its fields, category and notes. «Роз'єднати» gives both back as they were (edge case 4). The search of
 * «Можливий дубль» itself is module duplicate-matching's rule; «Не дубль» keeps the pair from it for good.
 */

export interface MergeSide {
  readonly id: string;
  readonly accountId: string;
  readonly subaccountId: string;
  readonly amount: Money;
  readonly hidden: boolean;
  readonly transfer: TransferLink | null;
  readonly mergedInto: string | null;
}

/**
 * What stops merging `duplicate` into `kept` (`duplicateId` is the field of the request): one operation twice is on one
 * account with the same amount and currency (FR 10, FR 12; the user's own choice needs no date window); neither is
 * hidden, a side of a transfer (FR 18) or merged already; the duplicate is not one others were merged into (no chains,
 * so «Роз'єднати» always gives back what was merged). `duplicateHasDuplicates` — whether others were merged into the
 * duplicate.
 */
export function mergeIssues(
  kept: MergeSide,
  duplicate: MergeSide,
  duplicateHasDuplicates: boolean,
): FieldIssue[] {
  if (kept.id === duplicate.id) return [{ field: "duplicateId", issue: "invalid" }];
  const issues: FieldIssue[] = [];
  for (const [field, side] of [
    ["transactionId", kept],
    ["duplicateId", duplicate],
  ] as const) {
    if (side.mergedInto !== null) issues.push({ field, issue: "merged" });
    else if (side.hidden) issues.push({ field, issue: "hidden" });
    if (side.transfer !== null) issues.push({ field, issue: "in_transfer" });
  }
  if (duplicateHasDuplicates) issues.push({ field: "duplicateId", issue: "has_duplicates" });
  if (kept.accountId !== duplicate.accountId)
    issues.push({ field: "duplicateId", issue: "account_mismatch" });
  else if (kept.subaccountId !== duplicate.subaccountId || !kept.amount.equals(duplicate.amount))
    issues.push({ field: "duplicateId", issue: "amount_mismatch" });
  return issues;
}

/** «Не дубль» (FR 12): only a pair that could be one — two transactions on one account, same amount and currency. */
export function dismissIssues(transaction: MergeSide, counterpart: MergeSide): FieldIssue[] {
  if (transaction.id === counterpart.id) return [{ field: "counterpartId", issue: "invalid" }];
  if (transaction.accountId !== counterpart.accountId)
    return [{ field: "counterpartId", issue: "account_mismatch" }];
  if (!transaction.amount.equals(counterpart.amount))
    return [{ field: "counterpartId", issue: "amount_mismatch" }];
  return [];
}

/** The pair of «Не дубль» in the order of its ids, as stored. */
export function dismissalPair(a: string, b: string): readonly [string, string] {
  return a < b ? [a, b] : [b, a];
}
