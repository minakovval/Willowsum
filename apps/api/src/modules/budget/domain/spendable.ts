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
  /** FR 4: amount ÷ days left, down to the minor unit (the last day — the rest, in minor units); overspent or ≤ 0 — 0. */
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
  // FR 14: the mandatory rest less each category's own unpaid payments (they are in `regularPayments` already).
  const mandatory = summary.mandatoryRest;
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
      : // The last day (days = 1) too: the rest, in the currency's minor units (FR 4).
        Money.of(amount.amount.div(days).toDecimalPlaces(minor, Decimal.ROUND_DOWN), currency);
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

/** FR 6: an active goal as «План» plans it (module goals, in the budget's currency; `PlanGoal` and what is contributed). */
export interface SpendableGoal {
  readonly goalId: string;
  /** The required monthly contribution; null — no figure (no rate) while the goal has a date ahead. */
  readonly required: Money | null;
  /** The month of the goal's date: nothing planned after it; null — nothing planned (no date or past it). */
  readonly lastPeriod: Period | null;
  /** Contributed this calendar month; null — no rate. */
  readonly contributed: Money | null;
}

export interface GoalContributions {
  readonly rows: readonly {
    readonly goalId: string;
    /** The month's cell of «План» (default — the required contribution; a goal without a date — 0). */
    readonly planned: Money;
    readonly contributed: Money;
    /** `planned` is the goal's required contribution (no cell of its own) — at today's rate, maybe the nearest one. */
    readonly fromRequired: boolean;
    /** max(0, planned − contributed): what the sum still holds back. */
    readonly amount: Money;
  }[];
  /** Σ amount — what the plan still holds back this month. */
  readonly total: Money;
  /** Σ contributed this month: contributions are no spending but lower the sum (business rules). */
  readonly contributed: Money;
  /** FR 10: the month's planned savings — Σ planned and «Заощадження без цілі». */
  readonly plannedSavings: Money;
}

/**
 * FR 6, FR 10 (BUD-05 FR 5, BUD-17 FR 1–2): each active goal's planned contribution of `period` from the grid «План» —
 * its own cell, else the required contribution up to the month of its date, else 0 — less what is contributed this
 * month, never below 0; what is contributed lowers the sum too (business rules: «внески в цілі … зменшують суму»), so
 * «Цілі» of the sum = total + contributed = Σ max(planned, contributed). Null — a figure is missing (no rate): no sum
 * beats a wrong one.
 */
export function goalContributions(
  period: Period,
  goals: readonly SpendableGoal[],
  /** The month's own cells of «План» (`kind` goal and savings count). */
  cells: readonly {
    readonly period: Period;
    readonly kind: string;
    readonly lineId: string | null;
    readonly amount: Money | null;
  }[],
  currency: string,
): GoalContributions | null {
  const zero = Money.zero(currency);
  const own = (kind: string, lineId: string | null) =>
    cells.find((c) => c.period === period && c.kind === kind && c.lineId === lineId && c.amount !== null)
      ?.amount ?? null;
  const rows: GoalContributions["rows"][number][] = [];
  for (const g of goals) {
    const dated = g.lastPeriod !== null && period <= g.lastPeriod;
    const cell = own("goal", g.goalId);
    const planned = cell ?? (dated ? g.required : zero);
    if (planned === null || g.contributed === null) return null;
    const rest = planned.minus(g.contributed);
    rows.push({
      goalId: g.goalId,
      planned,
      contributed: g.contributed,
      fromRequired: cell === null && dated,
      amount: rest.isNegative() ? zero : rest,
    });
  }
  assertCurrency(
    currency,
    rows.flatMap((r) => [r.planned, r.contributed]),
  );
  const sum = (xs: readonly Money[]) => xs.reduce((t, x) => t.plus(x), zero);
  return {
    rows,
    total: sum(rows.map((r) => r.amount)),
    contributed: sum(rows.map((r) => r.contributed)),
    plannedSavings: sum([...rows.map((r) => r.planned), own("savings", null) ?? zero]),
  };
}

/** FR 6: a debt's planned expense of the month — the payoff plan's extra payment, or the month's cell of «План». */
export interface DebtPlannedExpense {
  readonly accountId: string;
  readonly amount: Money;
  /** EC4 «приблизно»: the plan's amount at the nearest rate; a cell (the budget's currency) is exact. */
  readonly approximate: boolean;
}

/**
 * FR 6 «Заплановані витрати» (BUD-02 FR 15, BUD-17 FR 2; #661): each debt's planned expense of `period` — the saved
 * payoff plan's extra payment, and a month's own `debt` cell of «План» in place of it (never added to it), as the grid
 * shows the debt's «додатковий платіж». A cell counts only for a debt the month owes (`owed`: a minimum payment or a
 * plan's extra payment) — a debt it no longer owes does not come back for it; an empty cell is no value.
 */
export function plannedDebtExpenses(
  period: Period,
  plan: readonly { readonly accountId: string; readonly amount: Money; readonly approximate?: boolean }[],
  owed: ReadonlySet<string>,
  cells: readonly {
    readonly period: Period;
    readonly kind: string;
    readonly lineId: string | null;
    readonly amount: Money | null;
  }[],
  currency: string,
): { readonly items: readonly DebtPlannedExpense[]; readonly total: Money; readonly approximate: boolean } {
  const byDebt = new Map<string, DebtPlannedExpense>(
    plan.map((p) => [
      p.accountId,
      { accountId: p.accountId, amount: p.amount, approximate: p.approximate === true },
    ]),
  );
  for (const c of cells)
    if (
      c.period === period &&
      c.kind === "debt" &&
      c.lineId !== null &&
      c.amount !== null &&
      owed.has(c.lineId)
    )
      byDebt.set(c.lineId, { accountId: c.lineId, amount: c.amount, approximate: false });
  const items = [...byDebt.values()];
  assertCurrency(
    currency,
    items.map((i) => i.amount),
  );
  return {
    items,
    total: items.reduce((t, i) => t.plus(i.amount), Money.zero(currency)),
    approximate: items.some((i) => i.approximate),
  };
}

/**
 * FR 8, AC9: «Обов'язкові категорії: ще потрібно N €» by category — as FR 14 counts it: max(0, limit − spent − the
 * category's own unpaid payments). Only the categories that still need something.
 */
export function mandatoryNeeds(
  lines: readonly LimitLine[],
  obligations: PeriodObligations,
  currency: string,
): { readonly categoryId: string; readonly amount: Money }[] {
  const zero = Money.zero(currency);
  const unpaid = new Map<string, Money>();
  for (const r of obligations.recurring)
    if (!r.paid && r.categoryId !== null)
      unpaid.set(r.categoryId, (unpaid.get(r.categoryId) ?? zero).plus(r.amount));
  return lines
    .filter((l) => l.mandatory)
    .map((l) => ({
      categoryId: l.categoryId,
      amount: (l.remaining ?? l.limit).minus(unpaid.get(l.categoryId) ?? zero),
    }))
    .filter((n) => !n.amount.isNegative() && !n.amount.isZero());
}
