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
  /** FR 24: «Очікує» does not change the balance. */
  readonly status: "posted" | "pending";
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
  // The operation counts once (FR 11): a posted duplicate is never merged into an «Очікує» one, which would take the
  // operation out of the balance; the user merges the other way («Об'єднати з іншою» on the posted one).
  if (kept.status === "pending" && duplicate.status !== "pending")
    issues.push({ field: "transactionId", issue: "pending" });
  if (kept.accountId !== duplicate.accountId)
    issues.push({ field: "duplicateId", issue: "account_mismatch" });
  else if (kept.subaccountId !== duplicate.subaccountId || !kept.amount.equals(duplicate.amount))
    issues.push({ field: "duplicateId", issue: "amount_mismatch" });
  return issues;
}

/**
 * FR 11, FR 17 (AC26): who stays in a merge the user asked for on `requested` with `other`. Of a manual and an imported
 * transaction the imported one stays, whichever side the user acted on: the bank's posting is kept and the manual one's
 * reversed, so the operation counts once and the balance matches the bank; the manual one's category goes over to it
 * (`intoBank`). Otherwise the one acted on stays. `swapped` — the one acted on is the duplicate: issues name its field.
 */
export function mergeRoles<T extends { readonly source: "manual" | "imported" }>(
  requested: T,
  other: T,
): { readonly kept: T; readonly duplicate: T; readonly swapped: boolean; readonly intoBank: boolean } {
  const swapped = requested.source === "manual" && other.source === "imported";
  const [kept, duplicate] = swapped ? [other, requested] : [requested, other];
  return { kept, duplicate, swapped, intoBank: kept.source === "imported" && duplicate.source === "manual" };
}

/** The issues of a merge with its sides swapped (mergeRoles): each names the field of the request it is about. */
export function issuesOfRequest(issues: readonly FieldIssue[], swapped: boolean): FieldIssue[] {
  if (!swapped) return [...issues];
  const other: Record<string, string> = { transactionId: "duplicateId", duplicateId: "transactionId" };
  return issues.map((i) => ({ ...i, field: other[i.field] ?? i.field }));
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
