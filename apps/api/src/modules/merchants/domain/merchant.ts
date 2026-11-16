/**
 * A merchant of the space (BUD-14@PoC FR 2, FR 3; wave 2 row 22). A merchant is born from the match key of a bank
 * description (normalize.ts) and keeps that key for good, so every transaction with such a description is its
 * transaction. A rename changes only the shown name; a merge points the merchant at the one it joined
 * (`mergedInto`), and «Роз'єднати» clears the pointer — the descriptions and transactions are never touched.
 */
export interface Merchant {
  readonly id: string;
  /** The match key of its descriptions (normalize.ts `merchantKey`). */
  readonly key: string;
  readonly name: string;
  /** FR 1: an intermediary without a visible recipient («посередник»). */
  readonly intermediary: boolean;
  /** FR 3: the merchant it joined by «Об'єднати з…», or null. Always a merchant that joined none (no chains). */
  readonly mergedInto: string | null;
  readonly version: number;
}

export type MergeIssue = "same_merchant" | "merged";

/**
 * FR 3, AC1: «Об'єднати з…» — `source` joins `target`, whose name stays. Both are merchants that joined none: the one
 * shown is always the one a transaction's description resolves to. Null — the merge may go ahead.
 */
export function mergeIssue(target: Merchant, source: Merchant): MergeIssue | null {
  if (target.id === source.id) return "same_merchant";
  if (target.mergedInto !== null || source.mergedInto !== null) return "merged";
  return null;
}
