import {
  chosenIssues,
  counterpartOf,
  counterpartRateRequest,
  COUNTERPART_AMOUNT_SHARE,
  COUNTERPART_WINDOW_DAYS,
  COUNTERPARTS_MAX,
  type ChosenIssue,
  type ChosenTransaction,
  type Counterpart,
  type CounterpartTransaction,
} from "../domain/index.ts";
import type { ProposalDeps } from "./proposals.ts";

/**
 * IMP-03@PoC FR 24 — «Позначити як переказ» in the detail of a transaction: the list of candidates for its other side
 * (domain counterparts.ts), read from the space's transactions as they are now; nothing is stored. «Поєднати в пару» is
 * the transactions module's «Позначити як переказ» of the chosen pair (`POST /v1/transactions/{id}/transfer`), with the
 * same consequences, journal and audit as «Підтвердити» of a proposal. An empty list is the state «Немає транзакцій для
 * пари в межах 7 днів до або після і 5 % суми» with the offer of a one-sided transfer (FR 22, a later part).
 */
export interface CounterpartDeps extends ProposalDeps {
  readonly candidates: ProposalDeps["candidates"] & {
    counterpartsOf(
      householdId: string,
      transactionId: string,
      query: { readonly windowDays: number; readonly amountShare: string; readonly limit: number },
    ): Promise<{
      readonly chosen: ChosenTransaction | null;
      readonly items: readonly CounterpartTransaction[];
    }>;
  };
}

export type CounterpartsResult =
  | { readonly kind: "not-found" }
  | { readonly kind: "invalid"; readonly issues: readonly ChosenIssue[] }
  | {
      readonly kind: "ok";
      readonly transaction: ChosenTransaction;
      readonly items: readonly Counterpart[];
      /** The read listed its `COUNTERPARTS_MAX`; there are more (farther in date or amount). */
      readonly more: boolean;
    };

export async function listCounterparts(
  deps: CounterpartDeps,
  householdId: string,
  transactionId: string,
): Promise<CounterpartsResult> {
  const { chosen, items } = await deps.candidates.counterpartsOf(householdId, transactionId, {
    windowDays: COUNTERPART_WINDOW_DAYS,
    amountShare: COUNTERPART_AMOUNT_SHARE.toString(),
    limit: COUNTERPARTS_MAX + 1,
  });
  if (chosen === null) return { kind: "not-found" };
  const issues = chosenIssues(chosen);
  if (issues.length > 0) return { kind: "invalid", issues };
  const listed = items.slice(0, COUNTERPARTS_MAX);
  const requests = listed.map((c) => counterpartRateRequest(chosen, c));
  const wanted = requests.filter((r) => r !== null);
  // Every rate of the list in one query of the history; none when every candidate is in the chosen one's currency.
  const rates = wanted.length === 0 ? [] : await deps.rates(wanted);
  let next = 0;
  return {
    kind: "ok",
    transaction: chosen,
    items: listed.map((c, i) =>
      counterpartOf(chosen, c, requests[i] === null ? null : (rates[next++] ?? null)),
    ),
    more: items.length > COUNTERPARTS_MAX,
  };
}
