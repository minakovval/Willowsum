import { currencyInfo, Decimal, Money } from "@willowsum/domain-kernel";
import { assertCurrency, categoriesSummary, type PeriodObligations } from "./allocation.ts";
import type { LimitLine, Period } from "./budget.ts";
import { periodDays } from "./budget.ts";

/**
 * «Можна витратити» (BUD-03@PoC FR 2–6, FR 10, FR 14, FR 15; wave 2 row 34 — part a, the calculation core): the sum to
 * the end of the current period, its daily limit and the five rows of the mini breakdown. Exact Decimal sums in the
 * budget's one currency; only the daily limit is rounded (down to the minor unit, FR 4). No I/O.
 */
export interface SpendableInput {
  /** «Сьогодні» — a day of `period` (the current period). */
  readonly today: string;
  readonly period: Period;
  /** FR 3: the plan of income (× the share of days for a proportional first period). */
  readonly incomePlan: Money;
  /** FR 3: the income that came in the period (pending ones too). */
  readonly incomeActual: Money;
  /** FR 3: regular incomes still expected in the period — added to the actual income against the plan. */
  readonly incomeExpected: Money;
  /** Every category with a limit, with its spending (FR 14: the mandatory ones' rest). */
  readonly lines: readonly LimitLine[];
  /** Spent in categories without a limit, «Поза планом» and «Без категорії» (business rules: they count too). */
  readonly outsidePlan: Money;
  /** FR 5: the month's regular payments and loans' monthly payments (port `BudgetObligations`). */
  readonly obligations: PeriodObligations;
  /** FR 6: the planned goal contributions of the month less what is already contributed, each not below 0. */
  readonly goalContributions: Money;
  /** FR 6: one-off expenses planned in the period (the debt payoff plan's «Додати до запланованих витрат»). */
  readonly plannedExpenses: Money;
  /** FR 10: the planned savings — the budget of a period without limits is the expected income less them. */
  readonly plannedSavings: Money;
}

export interface Spendable {
  readonly income: {
    readonly plan: Money;
    readonly actual: Money;
    /** The actual income plus the regular incomes still expected. */
    readonly expected: Money;
    /** FR 3: the bigger of the plan and the expected — what the sum uses. */
    readonly value: Money;
    /** FR 3, AC5 «очікується»: the plan is used, the income has not come in full yet. */
    readonly pending: boolean;
  };
  /** «Уже витрачене»: in the categories with a limit and outside them. */
  readonly spent: Money;
  /** FR 5: the unpaid regular payments of the period and the unpaid loans' monthly payments. */
  readonly regularPayments: Money;
  readonly goalContributions: Money;
  readonly plannedExpenses: Money;
  /** FR 14: Σ over the mandatory categories of max(0, limit − spent − their own unpaid payments). */
  readonly mandatory: Money;
  /** FR 2: income − spent − regular payments − goals and planned expenses − mandatory; negative shows with «−». */
  readonly amount: Money;
  /** FR 4: days to the end of the period, today included. */
  readonly daysLeft: number;
  /** FR 4: amount ÷ days left, down to the minor unit; the last day — the amount; overspent or ≤ 0 — 0. */
  readonly daily: Money;
  /**
   * FR 10, AC4: «Перевитрата N €» — N = spent − the budget of the period (the sum of the limits; without limits, the
   * expected income less the planned savings), with `base` — the optional categories' limits, which the shade
   * `over-1`…`over-8` divides N by (DS-23 п. 4; no optional limits — level 8). Null — no overspend.
   */
  readonly overspend: { readonly amount: Money; readonly base: Money } | null;
  /** FR 15: the five rows of the card, in order; «Цілі» holds the planned expenses too, so the rows add up to the sum. */
  readonly mini: readonly {
    readonly row: "income" | "spent" | "regular" | "goals" | "mandatory";
    readonly amount: Money;
  }[];
}

/** FR 4: days from `today` to the end of `period`, both included. */
export function daysLeft(today: string, period: Period): number {
  const end = periodDays(period).to;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) + 1;
}

/** FR 2–6, FR 10, FR 14, FR 15: «Можна витратити» of the current period. */
export function spendable(input: SpendableInput): Spendable {
  const currency = input.incomePlan.currency;
  const zero = Money.zero(currency);
  assertCurrency(currency, [
    input.incomeActual,
    input.incomeExpected,
    input.outsidePlan,
    input.goalContributions,
    input.plannedExpenses,
    input.plannedSavings,
  ]);
  const days = daysLeft(input.today, input.period);
  if (days < 1 || input.today < periodDays(input.period).from)
    throw new RangeError("today is not in the period");
  const summary = categoriesSummary(input.lines, currency, input.obligations);
  const regularPayments = summary.unpaidRecurring!;
  // D = the mandatory rest + every unpaid payment (allocation.ts): the rest alone is D less the payments.
  const mandatory = summary.mandatoryNeeded!.minus(regularPayments);
  const spent = summary.spent.plus(input.outsidePlan);
  const expected = input.incomeActual.plus(input.incomeExpected);
  const pending = input.incomePlan.compare(expected) > 0;
  const income = pending ? input.incomePlan : expected;
  const amount = income
    .minus(spent)
    .minus(regularPayments)
    .minus(input.goalContributions)
    .minus(input.plannedExpenses)
    .minus(mandatory);
  const budget = input.lines.length > 0 ? summary.limits : income.minus(input.plannedSavings);
  const over = spent.minus(budget);
  const overspend =
    over.isNegative() || over.isZero() ? null : { amount: over, base: summary.optionalLimits };
  const minor = currencyInfo(currency).minorUnits;
  const daily =
    overspend !== null || amount.isNegative() || amount.isZero()
      ? zero
      : days === 1
        ? amount
        : Money.of(amount.amount.div(days).toDecimalPlaces(minor, Decimal.ROUND_DOWN), currency);
  return {
    income: { plan: input.incomePlan, actual: input.incomeActual, expected, value: income, pending },
    spent,
    regularPayments,
    goalContributions: input.goalContributions,
    plannedExpenses: input.plannedExpenses,
    mandatory,
    amount,
    daysLeft: days,
    daily,
    overspend,
    mini: [
      { row: "income", amount: income },
      { row: "spent", amount: spent },
      { row: "regular", amount: regularPayments },
      { row: "goals", amount: input.goalContributions.plus(input.plannedExpenses) },
      { row: "mandatory", amount: mandatory },
    ],
  };
}
