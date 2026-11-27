import { cardPaymentsOf } from "../domain/index.ts";
import type { OneSidedDeps } from "./one-sided.ts";
import { listProposals, type ProposalDeps } from "./proposals.ts";

/**
 * BUD-01@PoC FR 7, AC4 (#722 D): «платіж на кредитну картку з відомого власного рахунку цього простору: обидві
 * транзакції стають переказом одразу». Run right after new transactions arrive in a space (an import batch's apply, a
 * transaction entered by hand): the proposals as «Пари · N» reads them now, the card payments among them with a side
 * among the new ones (domain cardPaymentsOf), each marked by the transactions module's «Позначити як переказ» — the
 * same mark, journal event and audit entry as «Підтвердити». Nothing is stored here; a pair the mark refuses (a side
 * changed or an account closed meanwhile) stays a proposal.
 */

export interface CardPaymentDeps extends ProposalDeps {
  /** The ids among `accountIds` that are credit cards of the space (module accounts' kind `credit-card`). */
  readonly cards: (householdId: string, accountIds: readonly string[]) => Promise<ReadonlySet<string>>;
  /** Whether transfers (`transactions.transfers`) are on for the space; off — nothing is marked. */
  readonly enabled: (householdId: string) => Promise<boolean>;
  /** The transactions module's `TransferMarking.mark`: true — marked now; false — refused, nothing changed. */
  readonly mark: (
    householdId: string,
    actorAccountId: string,
    outflowId: string,
    inflowId: string,
  ) => Promise<boolean>;
  /**
   * IMP-03@PoC FR 1, FR 14, FR 15 (row 139a): the one-sided check, run after the card payments over the space's free
   * transactions (index.ts `createCardPaymentTransfers`); left out — none.
   */
  readonly oneSided?: OneSidedDeps;
}

/** Which sides are new: the ids given, or the sides an import batch wrote. */
export type FreshSides = { readonly transactionIds: readonly string[] } | { readonly importBatchId: string };

export async function markCardPayments(
  deps: CardPaymentDeps,
  householdId: string,
  actorAccountId: string,
  fresh: FreshSides,
): Promise<number> {
  if (!(await deps.enabled(householdId))) return 0;
  const { proposals, candidates, more } = await listProposals(deps, householdId);
  // #731 item 1: a capped read may miss the other candidate of a side, so a pair could only look unambiguous — mark
  // none; the pairs stay proposals for the person.
  if (more || proposals.length === 0) return 0;
  const ids = "transactionIds" in fresh ? new Set(fresh.transactionIds) : null;
  const batchId = "importBatchId" in fresh ? fresh.importBatchId : null;
  const sides = new Map(
    proposals.flatMap((p) => [
      [p.outflow.transactionId, p.outflow],
      [p.inflow.transactionId, p.inflow],
    ]),
  );
  const isFresh = (id: string) =>
    ids?.has(id) === true || (batchId !== null && sides.get(id)?.importBatchId === batchId);
  if (!proposals.some((p) => isFresh(p.outflow.transactionId) || isFresh(p.inflow.transactionId))) return 0;
  const cards = await deps.cards(householdId, [...new Set(proposals.map((p) => p.inflow.accountId))]);
  let marked = 0;
  for (const p of cardPaymentsOf(proposals, cards, isFresh, candidates))
    if (await deps.mark(householdId, actorAccountId, p.outflow.transactionId, p.inflow.transactionId))
      marked++;
  return marked;
}
