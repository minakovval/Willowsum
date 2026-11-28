import type { ExchangeRate, Money } from "@willowsum/domain-kernel";
import { oneSidedToFlag, type SingleTransaction, type TransferSide } from "../domain/index.ts";
import { listProposals, type ProposalDeps } from "./proposals.ts";

/**
 * IMP-03@PoC FR 14, FR 15, FR 18, FR 22, FR 23 (row 242) — the one-sided transfers and the confirmed pairs of «Пари»,
 * and the search that flags. The flag itself, «Це переказ» and «Це не переказ» are the transactions module's (its row,
 * version and audit entry); here: which free transactions to flag (domain one-sided.ts), when — after new transactions
 * arrive (`markCardPayments`' caller) and on «Шукати пари знову» — and the reads of the two lists.
 */

/** The most free single transactions one check looks at (newest first); older ones are checked as these are decided. */
export const SINGLES_MAX = 2000;
/** The most rows one read of «Односторонні» or «Підтверджені» lists; `count` tells how many there are. */
export const PAIR_LIST_MAX = 200;

export interface OneSidedSide extends TransferSide {
  readonly counterparty: string | null;
  readonly description: string | null;
  readonly state: "flagged" | "marked";
  readonly evidence: readonly string[];
}

export interface ConfirmedPair {
  readonly id: string;
  readonly outflow: TransferSide & {
    readonly counterparty: string | null;
    readonly description: string | null;
  };
  readonly inflow: TransferSide & {
    readonly counterparty: string | null;
    readonly description: string | null;
  };
  readonly date: string;
  readonly rate: ExchangeRate | null;
  readonly difference: { readonly amount: Money; readonly side: "outflow" | "inflow" } | null;
  readonly feeCategoryId: string | null;
}

/** What the one-sided check and the lists need besides the proposals' ports (wired in src/main.ts). */
export interface OneSidedDeps {
  /** The transactions module's `TransferCandidates.singles`. */
  readonly singles: (householdId: string, limit: number) => Promise<readonly SingleTransaction[]>;
  /** The transactions module's `TransferCandidates.oneSided`. */
  readonly oneSided: (
    householdId: string,
    limit: number,
  ) => Promise<{ readonly items: readonly OneSidedSide[]; readonly count: number }>;
  /** The transactions module's `TransferCandidates.confirmed`. */
  readonly confirmed: (
    householdId: string,
    limit: number,
  ) => Promise<{ readonly items: readonly ConfirmedPair[]; readonly count: number }>;
  /** The ids among `accountIds` that are credit cards of the space (module accounts' kind `credit-card`). */
  readonly cards: (householdId: string, accountIds: readonly string[]) => Promise<ReadonlySet<string>>;
  /** The transactions module's `OneSidedFlagging.flag`: how many it flagged. */
  readonly flag: (
    householdId: string,
    actorAccountId: string,
    items: readonly { readonly transactionId: string; readonly evidence: readonly string[] }[],
  ) => Promise<number>;
  /** Today's date in the space (YYYY-MM-DD), from the injected clock. */
  readonly today: () => string;
}

/**
 * FR 14, FR 15: flags the free transactions that are one-sided transfers now — never a side of a pair the read scored
 * (an open proposal or its alternative: its pair may wait for «Підтвердити»). How many were flagged.
 */
export async function flagOneSidedTransfers(
  deps: ProposalDeps,
  oneSided: OneSidedDeps,
  householdId: string,
  actorAccountId: string,
): Promise<number> {
  const singles = await oneSided.singles(householdId, SINGLES_MAX);
  if (singles.length === 0) return 0;
  const { candidates } = await listProposals(deps, householdId);
  const proposed = new Set(candidates.flatMap((c) => [c.outflow.transactionId, c.inflow.transactionId]));
  const positiveAccounts = [
    ...new Set(singles.filter((s) => !s.amount.isNegative()).map((s) => s.accountId)),
  ];
  const cards =
    positiveAccounts.length === 0 ? new Set<string>() : await oneSided.cards(householdId, positiveAccounts);
  const items = oneSidedToFlag(singles, { today: oneSided.today(), cards, proposed });
  return items.length === 0 ? 0 : oneSided.flag(householdId, actorAccountId, items);
}

/** FR 23 «Шукати пари знову»: the proposals again over every free transaction, and the one-sided transfers flagged. */
export async function searchPairsAgain(
  deps: ProposalDeps,
  oneSided: OneSidedDeps,
  householdId: string,
  actorAccountId: string,
): Promise<{ readonly count: number; readonly more: boolean; readonly flagged: number }> {
  const flagged = await flagOneSidedTransfers(deps, oneSided, householdId, actorAccountId);
  const { proposals, more } = await listProposals(deps, householdId);
  return { count: proposals.length, more, flagged };
}
