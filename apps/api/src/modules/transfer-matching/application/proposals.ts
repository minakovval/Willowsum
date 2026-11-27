import type { ExchangeRate } from "@willowsum/domain-kernel";
import {
  candidateQuery,
  proposalOf,
  chooseProposals,
  rateRequestOf,
  scored,
  type ChosenProposal,
  type PairCandidate,
  type ScoredProposal,
} from "../domain/index.ts";

/**
 * «Пари · N» (FIN-03@PoC FR 5, FR 6; wave 2 row 16b): the proposals of transfers between own accounts, found each time
 * they are read from the space's transactions as they are now — a transaction entered, changed, hidden, deleted or
 * marked is in the next read at once, and nothing is stored or marked by the search itself. «Підтвердити» is the
 * transactions module's «Позначити як переказ» of the pair, «Не пара» its «Не пара» (IMP-03 FR 12: the pair is never a
 * candidate again). IMP-03@PoC b) (row 48): each pair is scored (FR 3; below 55 — none) and the open proposals are
 * one-to-one with «неоднозначно з…» (FR 7, FR 12).
 */

/** The most candidate pairs one read looks at; `more` tells there were others (newest first). */
export const CANDIDATES_MAX = 500;

export interface ProposalDeps {
  /** The transactions module's public `TransferCandidates`. */
  readonly candidates: {
    candidatePairs(
      householdId: string,
      query: { readonly windowDays: number; readonly sameCurrencyMinShare: string; readonly limit: number },
    ): Promise<readonly PairCandidate[]>;
  };
  /** fx-rates' `rates`: the rate of each date or the nearest earlier one; null when there is none. */
  readonly rates: (
    requests: readonly { readonly from: string; readonly to: string; readonly date: string }[],
  ) => Promise<readonly (ExchangeRate | null)[]>;
}

export async function listProposals(
  deps: ProposalDeps,
  householdId: string,
): Promise<{
  readonly proposals: readonly ChosenProposal[];
  /** Every scored candidate of the read (the proposals among them), for the card payments' unambiguity (BUD-01 FR 7). */
  readonly candidates: readonly ScoredProposal[];
  readonly more: boolean;
}> {
  const found = await deps.candidates.candidatePairs(householdId, {
    ...candidateQuery,
    limit: CANDIDATES_MAX + 1,
  });
  const candidates = found.slice(0, CANDIDATES_MAX);
  const requests = candidates.map(rateRequestOf);
  const wanted = requests.filter((r) => r !== null);
  // Every rate of the read in one query of the history; none at all when every pair is in one currency.
  const rates = wanted.length === 0 ? [] : await deps.rates(wanted);
  let next = 0;
  const scoredPairs: ScoredProposal[] = [];
  candidates.forEach((candidate, i) => {
    const rate = requests[i] === null ? null : (rates[next++] ?? null);
    const proposal = proposalOf(candidate, rate);
    const withScore = proposal && scored(proposal);
    if (withScore) scoredPairs.push(withScore);
  });
  return {
    proposals: chooseProposals(scoredPairs),
    candidates: scoredPairs,
    more: found.length > CANDIDATES_MAX,
  };
}
