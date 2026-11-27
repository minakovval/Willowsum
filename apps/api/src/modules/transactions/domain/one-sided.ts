/**
 * IMP-03@PoC FR 14, FR 15, FR 22 — the one-sided transfer («односторонній переказ»), pure: a transaction whose other
 * side is on an account outside Willowsum. Module transfer-matching finds which free transactions to flag; here are
 * the states and how they change.
 *
 * - `flagged` — the system's flag: shown on «Пари → Односторонні», it still counts as an income or an expense (FR 14).
 * - `marked` — «Це переказ» (FR 22): neither income nor expense, out of the budget like a side of a transfer.
 * - `dismissed` — «Це не переказ» (FR 14): the flag is gone and never set again; it counts as usual.
 *
 * A pair made with the transaction («Підтвердити», «Поєднати в пару») clears `flagged` and `marked` (FR 14: «зникає
 * після парування»; AC11); `dismissed` stays.
 */

export const ONE_SIDED_STATES = ["flagged", "marked", "dismissed"] as const;
export type OneSidedState = (typeof ONE_SIDED_STATES)[number];

export interface OneSidedMark {
  readonly state: OneSidedState;
  /** Why it was flagged (module transfer-matching's codes); empty when the user marked it without a flag. */
  readonly evidence: readonly string[];
}

/** What a transaction is for the checks of «Це переказ» / «Це не переказ». */
export interface OneSidedCandidate {
  readonly amount: { isZero(): boolean };
  readonly status: string;
  readonly hidden: boolean;
  readonly split: unknown;
  readonly transfer: unknown;
  readonly mergedInto: string | null;
}

/** Why a transaction can be no one-sided transfer (the codes of «Позначити як переказ», FIN-03 FR 27). */
export type OneSidedIssue = "pending" | "hidden" | "split" | "in_transfer" | "merged" | "zero";

export function oneSidedIssues(t: OneSidedCandidate): OneSidedIssue[] {
  const issues: OneSidedIssue[] = [];
  if (t.status !== "posted") issues.push("pending");
  if (t.hidden) issues.push("hidden");
  if (t.split !== null) issues.push("split");
  if (t.transfer !== null) issues.push("in_transfer");
  if (t.mergedInto !== null) issues.push("merged");
  if (t.amount.isZero()) issues.push("zero");
  return issues;
}

/** «Це переказ» (true) or «Це не переказ» (false): the new mark, keeping the evidence of a flag. */
export function decidedOneSided(current: OneSidedMark | null | undefined, isTransfer: boolean): OneSidedMark {
  return { state: isTransfer ? "marked" : "dismissed", evidence: current?.evidence ?? [] };
}

/** The system's flag: only a transaction that never had a state gets one (a dismissed one never again, FR 14). */
export function flaggedOneSided(
  current: OneSidedMark | null | undefined,
  evidence: readonly string[],
): OneSidedMark | null {
  return current ? null : { state: "flagged", evidence: [...evidence] };
}

/** FR 14, AC11: paired — the flag and «Це переказ» are gone; «Це не переказ» stays. */
export function pairedOneSided(current: OneSidedMark | null | undefined): OneSidedMark | null {
  return current?.state === "dismissed" ? current : null;
}

/** Whether the budget and the reports leave the transaction out as a transfer (FR 22). */
export const countsAsTransfer = (mark: OneSidedMark | null | undefined): boolean => mark?.state === "marked";
