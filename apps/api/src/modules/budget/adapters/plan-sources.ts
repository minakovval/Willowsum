import { AmountOutOfRangeError, type Money } from "@willowsum/domain-kernel";
import type { DebtPlannedExpenses } from "../../debt-payoff/index.ts";
import type { FxReporting } from "../../fx-rates/index.ts";
import type { GoalPlans } from "../../goals/index.ts";
import type { RecurringMonth } from "../../recurring/index.ts";
import type { BudgetPlanSources } from "../application/index.ts";
import { periodOf } from "../domain/index.ts";
import { overBudgetCap as tooBig } from "./money-range.ts";

/**
 * The port `BudgetPlanSources` of «План» (BUD-17@PoC FR 1) over modules goals (`GoalPlans`), debt-payoff
 * (`DebtPlannedExpenses`), recurring (`RecurringMonth`: the month's expected regular incomes; left out — none) and
 * fx-rates: amounts of another currency at today's rate, as `BudgetObligations` (#567).
 * An amount without a rate or over 15 integer digits has no figure (null), never a sum without it.
 */
export function createBudgetPlanSources(ports: {
  readonly goals: GoalPlans;
  readonly debts: DebtPlannedExpenses;
  readonly fx: Pick<FxReporting, "total">;
  readonly recurring?: RecurringMonth;
  /**
   * #613: whether «План» (release flag `budget.plan`) is on for the space. While it is off the regular incomes are not
   * read: the month's income plan stays the budget's «План доходу» (BUD-02 FR 9, FR 14) on «Бюджет», in «Порівняння»
   * and in a finished month's snapshot, as before «План». Left out — on.
   */
  readonly planEnabled?: (householdId: string) => Promise<boolean>;
}): BudgetPlanSources {
  /**
   * Each amount in `currency`; null in its place — no rate, or out of range. `approximate` — converted at the nearest
   * rate (BUD-03@PoC EC4, «приблизно»: the latest rate is older than 3 days).
   */
  async function convert(
    amounts: readonly Money[],
    currency: string,
  ): Promise<({ value: Money; approximate: boolean } | null)[]> {
    if (amounts.length === 0) return [];
    if (amounts.every((a) => a.currency === currency))
      return amounts.map((a) => (tooBig(a) ? null : { value: a, approximate: false }));
    try {
      const reported = await ports.fx.total(
        amounts.map((amount) => ({ amount, date: null })),
        currency,
      );
      return reported.items.map((item) =>
        item.kind === "rate-unavailable" || tooBig(item.value)
          ? null
          : {
              value: item.value,
              // Nothing at any rate is still nothing: a zero amount is exact.
              approximate: item.kind === "converted" && item.conversion.approximate && !item.value.isZero(),
            },
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
      // BUD-03@PoC FR 6: what is already contributed this month, at today's rate too (null — no rate).
      const contributed = await convert(
        goals.map((g) => g.contributedThisMonth),
        currency,
      );
      return goals.map((g, i) => ({
        goalId: g.goalId,
        required: byGoal.get(g.goalId)?.value ?? null,
        contributed: contributed[i]?.value ?? null,
        // BUD-03@PoC EC4: «приблизно» — an amount of the goal at the nearest rate.
        requiredApproximate: byGoal.get(g.goalId)?.approximate ?? false,
        contributedApproximate: contributed[i]?.approximate ?? false,
        // No date or past it (BUD-05 FR 5: no required contribution) — nothing is planned for the goal.
        lastPeriod: g.requiredMonthly === null || g.targetDate === null ? null : periodOf(g.targetDate),
      }));
    },
    async incomes(householdId, period, currency) {
      if (!ports.recurring) return [];
      if (ports.planEnabled && !(await ports.planEnabled(householdId))) return [];
      // FR 1 «джерела доходу»: each income payment's charges in the month (BUD-02 FR 1, BUD-03 and BUD-07 rules:
      // «регулярні доходи формують очікуваний дохід»), one line per payment in the order of its first charge.
      const charges = (await ports.recurring.chargesIn(householdId, period)).filter(
        (c) => c.type === "income",
      );
      const converted = await convert(
        charges.map((c) => c.expected),
        currency,
      );
      const byPayment = new Map<string, Money | null>();
      // BUD-03@PoC EC4 «приблизно» (#651): a charge of the payment at the nearest rate.
      const nearest = new Set<string>();
      charges.forEach((c, i) => {
        const prev = byPayment.get(c.paymentId);
        const value = converted[i]?.value ?? null;
        if (converted[i]?.approximate === true) nearest.add(c.paymentId);
        byPayment.set(
          c.paymentId,
          prev === undefined ? value : prev === null || value === null ? null : prev.plus(value),
        );
      });
      return [...byPayment].map(([paymentId, amount]) => ({
        paymentId,
        amount,
        approximate: amount !== null && nearest.has(paymentId),
      }));
    },
    async extraPayments(householdId, period, currency) {
      const planned = await ports.debts.inMonth(householdId, period);
      const converted = await convert(
        planned.map((p) => p.amount),
        currency,
      );
      if (converted.some((c) => c === null)) return null;
      return planned.map((p, i) => ({
        accountId: p.accountId,
        amount: converted[i]!.value,
        approximate: converted[i]!.approximate,
      }));
    },
  };
}
