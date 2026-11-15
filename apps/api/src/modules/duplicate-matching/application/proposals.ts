import { candidateQuery, isPossibleDuplicate, type DuplicatePair } from "../domain/index.ts";

/**
 * «Можливий дубль» (FIN-03@PoC FR 12, FR 18; wave 2 row 16c): the pairs found each time they are read from the space's
 * transactions as they are now — a transaction entered, changed, hidden, merged or deleted is in the next read at once;
 * a pair the user called «Не дубль» never comes back. Nothing is stored or marked by the search itself. «Об'єднати» and
 * «Не дубль» are the transactions module's actions on the pair.
 */

/** The most pairs one read looks at; `more` tells there were others (newest first). */
export const CANDIDATES_MAX = 500;

export interface DuplicateDeps {
  /** The transactions module's public `DuplicateCandidates`. */
  readonly candidates: {
    candidatePairs(
      householdId: string,
      query: { readonly windowDays: number; readonly limit: number },
    ): Promise<readonly DuplicatePair[]>;
    candidatesOf(
      householdId: string,
      transactionId: string,
      query: { readonly windowDays: number },
    ): Promise<readonly DuplicatePair[]>;
  };
}

export async function listDuplicates(
  deps: DuplicateDeps,
  householdId: string,
): Promise<{ readonly pairs: readonly DuplicatePair[]; readonly more: boolean }> {
  const found = await deps.candidates.candidatePairs(householdId, {
    ...candidateQuery,
    limit: CANDIDATES_MAX + 1,
  });
  const pairs = found.slice(0, CANDIDATES_MAX).filter((p) => isPossibleDuplicate(p.first, p.second));
  return { pairs, more: found.length > CANDIDATES_MAX };
}

/** FR 18: whether the transaction is a «Можливий дубль» now — the only kind of transaction that may be hidden. */
export async function isDuplicateNow(
  deps: DuplicateDeps,
  householdId: string,
  transactionId: string,
): Promise<boolean> {
  const pairs = await deps.candidates.candidatesOf(householdId, transactionId, candidateQuery);
  return pairs.some((p) => isPossibleDuplicate(p.first, p.second));
}
