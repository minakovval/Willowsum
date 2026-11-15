import type { ExchangeRate } from "@willowsum/domain-kernel";
import {
  candidateQuery,
  proposalOf,
  rateRequestOf,
  type PairCandidate,
  type TransferProposal,
} from "../domain/index.ts";

/**
 * «Пари · N» (FIN-03@PoC FR 5, FR 6; wave 2 row 16b): the proposals of transfers between own accounts, found each time
 * they are read from the space's transactions as they are now — a transaction entered, changed, hidden, deleted or
 * marked is in the next read at once, and nothing is stored or marked by the search itself. «Підтвердити» is the
 * transactions module's «Позначити як переказ» of the pair.
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
): Promise<{ readonly proposals: readonly TransferProposal[]; readonly more: boolean }> {
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
  const proposals: TransferProposal[] = [];
  candidates.forEach((candidate, i) => {
    const rate = requests[i] === null ? null : (rates[next++] ?? null);
    const proposal = proposalOf(candidate, rate);
    if (proposal) proposals.push(proposal);
  });
  return { proposals, more: found.length > CANDIDATES_MAX };
}
