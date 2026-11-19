import { AmountOutOfRangeError, type Money } from "@willowsum/domain-kernel";
import type { DebtPlannedExpenses } from "../../debt-payoff/index.ts";
import type { FxReporting } from "../../fx-rates/index.ts";
import type { GoalPlans } from "../../goals/index.ts";
import type { BudgetPlanSources } from "../application/index.ts";
import { periodOf } from "../domain/index.ts";
import { overBudgetCap as tooBig } from "./money-range.ts";

/**
 * The port `BudgetPlanSources` of «План» (BUD-17@PoC FR 1) over modules goals (`GoalPlans`), debt-payoff
 * (`DebtPlannedExpenses`) and fx-rates: amounts of another currency at today's rate, as `BudgetObligations` (#567).
 * An amount without a rate or over 15 integer digits has no figure (null), never a sum without it.
 */
export function createBudgetPlanSources(ports: {
  readonly goals: GoalPlans;
  readonly debts: DebtPlannedExpenses;
  readonly fx: Pick<FxReporting, "total">;
}): BudgetPlanSources {
  /** Each amount in `currency`; null in its place — no rate, or out of range. */
  async function convert(amounts: readonly Money[], currency: string): Promise<(Money | null)[]> {
    if (amounts.length === 0) return [];
    if (amounts.every((a) => a.currency === currency)) return amounts.map((a) => (tooBig(a) ? null : a));
    try {
      const reported = await ports.fx.total(
        amounts.map((amount) => ({ amount, date: null })),
        currency,
      );
      return reported.items.map((item) =>
        item.kind === "rate-unavailable" || tooBig(item.value) ? null : item.value,
      );
    } catch (error) {
      if (error instanceof AmountOutOfRangeError) return amounts.map(() => null);
      throw error;
    }
  }
  return {
    async goals(householdId, currency) {
      const goals = await ports.goals.active(householdId);
      const required = goals.filter((g) => g.requiredMonthly !== null);
      const converted = await convert(
        required.map((g) => g.requiredMonthly!),
        currency,
      );
      const byGoal = new Map(required.map((g, i) => [g.goalId, converted[i] ?? null]));
      return goals.map((g) => ({
        goalId: g.goalId,
        required: byGoal.get(g.goalId) ?? null,
        // No date or past it (BUD-05 FR 5: no required contribution) — nothing is planned for the goal.
        lastPeriod: g.requiredMonthly === null || g.targetDate === null ? null : periodOf(g.targetDate),
      }));
    },
    async extraPayments(householdId, period, currency) {
      const planned = await ports.debts.inMonth(householdId, period);
      const converted = await convert(
        planned.map((p) => p.amount),
        currency,
      );
      if (converted.some((c) => c === null)) return null;
      return planned.map((p, i) => ({ accountId: p.accountId, amount: converted[i]! }));
    },
  };
}
