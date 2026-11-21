import {
  historyPeriods,
  monthHistory,
  proposeFromSpending,
  startChoices,
  type BudgetCategory,
  type Proposal,
  type StartChoice,
} from "../domain/index.ts";
import type { BudgetReads } from "./budget.ts";

/** What the budget wizard shows before the budget is saved (FR 2, FR 3, FR 5, FR 14). */
export interface Wizard {
  readonly today: string;
  /** FR 14, AC15: «Ви починаєте посеред періоду» — false on the 1st of a month (FR 5). No default choice. */
  readonly midPeriod: boolean;
  readonly starts: readonly StartChoice[];
  /** FR 2, FR 3, AC1, edge cases 1–2: «Створити за моїми витратами» — available or not, and its proposal. */
  readonly fromSpending: Proposal;
}

/**
 * The wizard's figures: the start choices for today and the proposal over the 6 full months before the current one,
 * read like a period (FR 12) from `accountIds` — the accounts the budget would take — in the space's reporting currency.
 * Read only: nothing is saved until «Створити бюджет» (POST /v1/budget with the edited limits and income plan).
 */
export async function wizard(
  deps: { readonly today: () => string; readonly reportingCurrency: string; readonly reads: BudgetReads },
  householdId: string,
  accountIds: readonly string[],
  categories: ReadonlyMap<string, BudgetCategory>,
): Promise<Wizard> {
  const today = deps.today();
  const currency = deps.reportingCurrency;
  const months = [];
  for (const period of historyPeriods(today)) {
    const { amounts } = await deps.reads.amounts(householdId, accountIds, period, currency);
    // BUD-06@PoC FR 8: «Одноразова витрата» leaves the template «Створити за моїми витратами» (its averages), but its
    // month still has categorized history (FR 2: 3 months in a row) — #685.
    const history = monthHistory(
      period,
      currency,
      categories,
      amounts.filter((a) => a.oneOff !== true),
    );
    months.push({ ...history, categorized: amounts.some((a) => a.categoryId !== null) });
  }
  const { midPeriod, choices } = startChoices(today);
  return {
    today,
    midPeriod,
    starts: choices,
    fromSpending: proposeFromSpending(currency, months),
  };
}
