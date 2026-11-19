import type { Money } from "@willowsum/domain-kernel";
import { averageMonthlyExpenses, cushionWindow } from "../domain/index.ts";
import type { GoalReads, SpendCandidateRow, SpendCandidatesAfter, StoredGoal } from "./goals.ts";

/** «Подушка безпеки» (FR 10, AC 3): what the form shows under «Скільки місяців витрат». */
export interface CushionAverage {
  readonly currency: string;
  /** Half to even to minor units; null — no expense in the window, or none with a rate. */
  readonly average: Money | null;
  /** «за N міс.»: the months of history the average is over (0–6). */
  readonly months: number;
  readonly from: string;
  readonly to: string;
  /** «приблизно»: some day's expenses at the nearest earlier rate, or some left out without a rate. */
  readonly approximate: boolean;
  /** Days' expenses left out for want of a rate. */
  readonly unavailableCount: number;
}

/**
 * FR 10, AC 3: the average monthly expenses of the space — the server sum of the last 6 full months' expenses (no
 * transfer between own accounts, no hidden or merged transaction), each day at its rate into `currency`, over the months
 * of history. There is no «Одноразові витрати» mark in this release, so nothing more is left out (lead decision).
 */
export async function cushionAverage(
  reads: GoalReads,
  householdId: string,
  currency: string,
  today: string,
): Promise<CushionAverage> {
  const window = cushionWindow(today);
  const e = await reads.expenses(householdId, window, currency);
  const { average, months } =
    e.total === null ? { average: null, months: 0 } : averageMonthlyExpenses(e.total, e.firstDate, today);
  return {
    currency,
    average,
    months,
    ...window,
    approximate: e.nearestRateCount > 0 || e.unavailableCount > 0,
    unavailableCount: e.unavailableCount,
  };
}

/**
 * FR 8 «Витратити» (#559): a page of the transactions the goal may spend — outgoing, «Проведена», shown, no transfer
 * side, in the goal's currency, on the part's account (any account of the space for a goal of marks) and not spent from
 * any goal yet; newest first, with how many there are in all («Ще N»).
 */
export async function spendable(
  reads: GoalReads,
  householdId: string,
  goal: StoredGoal,
  /** Every transaction spent from a goal of the space (`GoalsTx.spentTransactionIds`). */
  excluded: readonly string[],
  query: {
    readonly search: string | null;
    readonly after: SpendCandidatesAfter | null;
    readonly limit: number;
  },
): Promise<{ readonly items: readonly SpendCandidateRow[]; readonly count: number }> {
  return reads.candidates(householdId, {
    accountId: goal.partKind === "marks" ? null : goal.accountId,
    currency: goal.target.currency,
    excluded,
    search: query.search,
    after: query.after,
    limit: query.limit,
  });
}
