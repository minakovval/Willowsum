import { Money } from "@willowsum/domain-kernel";
import {
  allocationBalance,
  allocationChoice,
  checkAllocation,
  convertLines,
  goalContributions,
  withPlanRates,
  plannedContributions,
  firstPeriodChoices,
  isPeriod,
  parseBudgetAmount,
  periodDays,
  periodFigures,
  periodOf,
  plannedDebtExpenses,
  scalePlan,
  shareFrom,
  spendable,
  startChoices,
  type AllocationBalance,
  type AllocationCell,
  type AllocationChoice,
  type AllocationLines,
  type AllocationRowInput,
  type BudgetCategory,
  type BudgetIssue,
  type Period,
  type PeriodObligations,
  type PeriodPlan,
} from "../domain/index.ts";
import {
  checkIncome,
  checkLimits,
  inputRates,
  type BudgetDeps,
  type IncomePlanInput,
  type LimitInput,
  type Result,
} from "./budget.ts";

type MoneyInput = { readonly amount: string; readonly currency: string };

/** The most amounts «Розподіл» sums in one request (goals, debts, «Заощадження без цілі», deficit options). */
export const CHOSEN_MAX = 100;

export interface AllocationInput {
  readonly firstPeriod: string;
  readonly proportional?: boolean | undefined;
  readonly incomePlan?: MoneyInput | undefined;
  /** FR 21: «План доходу» by income category — the income plan is their sum; not with `incomePlan`. */
  readonly incomePlans?: readonly IncomePlanInput[] | undefined;
  readonly limits?: readonly LimitInput[] | undefined;
  /** The amounts chosen on the step, untyped (the calculation only). */
  readonly chosen?: readonly MoneyInput[] | undefined;
  /** FR 15: the typed rows of «Розподіл» — what POST /v1/budget saves; not with `chosen`. */
  readonly allocation?: readonly AllocationRowInput[] | undefined;
}

/** The plan the wizard holds, checked and figured as the first period would have it (FR 3, FR 14, FR 15). */
export interface AllocationPlan {
  readonly period: Period;
  /** FR 14: the day a proportional first period counts from; null — the whole month. */
  readonly from: string | null;
  /** The plan the figures use: × the share of days for a proportional first period (FR 14); not mandatory yet. */
  readonly plan: PeriodPlan;
  readonly limits: Money;
  readonly obligations: PeriodObligations | null;
  /** Null — the regular payments and debts are not known (`BudgetObligations` not wired, or no rate for one). */
  readonly balance: AllocationBalance | null;
  /** Null without `chosen` / `allocation` or without the balance. */
  readonly choice: AllocationChoice | null;
  /** FR 15: the cells the first period stores (from `allocation`); empty without it. */
  readonly cells: readonly AllocationCell[];
  /** The goals and debts the rows may name, as read; null — not read (the month's obligations not known). */
  readonly lines: AllocationLines | null;
}

/**
 * FR 15: the lines of «Розподіл» — the space's active goals (module goals) and the debts the month owes: a minimum
 * payment (`BudgetObligations`) or a saved payoff plan's extra payment (module debt-payoff), as «План» shows them.
 */
async function allocationLines(
  deps: Pick<BudgetDeps, "planSources">,
  householdId: string,
  period: Period,
  currency: string,
  obligations: PeriodObligations,
): Promise<AllocationLines> {
  const sources = deps.planSources;
  const [goals, extra] = sources
    ? await Promise.all([
        sources.goals(householdId, currency),
        sources.extraPayments(householdId, period, currency),
      ])
    : [[], []];
  return {
    goals,
    debtAccountIds: new Set([
      ...obligations.debtMinimums.map((d) => d.accountId),
      ...(extra ?? []).map((e) => e.accountId),
    ]),
  };
}

/**
 * FR 3, FR 15, AC6, AC7: the plan the wizard holds (not saved yet) — the start as POST /v1/budget takes it
 * (`firstPeriod`, `proportional`), the income plan, the limits — with the balance of «Розподіл» and the amounts chosen
 * on it: untyped (`chosen`, the calculation) or the typed rows (`allocation`), checked with the same rules POST
 * /v1/budget saves them with. Read only.
 */
export async function planAllocation(
  deps: Pick<BudgetDeps, "today" | "reportingCurrency" | "obligations" | "planSources" | "rates">,
  householdId: string,
  input: AllocationInput,
  categories: ReadonlyMap<string, BudgetCategory>,
): Promise<Result<AllocationPlan>> {
  const currency = deps.reportingCurrency;
  const today = deps.today();
  const issues: BudgetIssue[] = [];
  if (!isPeriod(input.firstPeriod) || !firstPeriodChoices(today).includes(input.firstPeriod))
    issues.push({ field: "firstPeriod", issue: "invalid" });
  const proportional = startChoices(today).choices.find((c) => c.start === "proportional");
  if (input.proportional === true && proportional?.firstPeriod !== input.firstPeriod)
    issues.push({ field: "proportional", issue: "invalid" });
  // BUD-02 FR 24: a limit or an income plan in another currency — at today's rate, as the saved budget.
  const rates = await inputRates(deps, currency, input);
  const incomeChecked = checkIncome(input, categories, currency, rates);
  issues.push(...incomeChecked.issues);
  const income = incomeChecked.total;
  const checked = checkLimits(input.limits ?? [], categories, currency, rates);
  issues.push(...checked.issues);
  const chosen: Money[] = [];
  (input.chosen ?? []).forEach((c, i) => {
    const m = parseBudgetAmount(`chosen.${i}`, c, currency);
    if (m instanceof Money) chosen.push(m);
    else issues.push(m);
  });
  if (input.chosen !== undefined && input.allocation !== undefined)
    issues.push({ field: "chosen", issue: "with_allocation" });
  if (issues.length > 0 || income === null) return { kind: "invalid", issues };
  const limits = checked.limits.flatMap((l) => (l.amount === null ? [] : [{ ...l, amount: l.amount }]));
  // FR 14: a proportional first period — the plan × (days left, today included) ÷ (days in the period).
  const share = input.proportional === true ? shareFrom(today) : null;
  const whole: PeriodPlan = withPlanRates(
    {
      incomePlan: income,
      incomePlans: convertLines(incomeChecked.rows, currency, rates),
      plannedSavings: Money.zero(currency),
      limits: convertLines(limits, currency, rates).map((l) => ({
        ...l,
        mandatory: categories.get(l.categoryId)?.essential ?? false,
      })),
    },
    rates,
  );
  const plan = share ? scalePlan(whole, share) : whole;
  const limitsTotal = plan.limits.reduce((t, l) => t.plus(l.amount), Money.zero(currency));
  const period = input.firstPeriod;
  const obligations =
    deps.obligations === null
      ? null
      : await deps.obligations.month(householdId, period, currency, share?.from);
  const lines =
    obligations === null ? null : await allocationLines(deps, householdId, period, currency, obligations);
  // Q5 а: the goals' planned contributions are subtracted as «План» subtracts them; a goal without a rate — no figure.
  const goalContributions = lines === null ? null : plannedContributions(lines.goals, period, currency);
  const balance =
    obligations === null || goalContributions === null
      ? null
      : allocationBalance({
          incomePlan: plan.incomePlan,
          limits: plan.limits,
          obligations,
          goalContributions,
        });
  const base = { period, from: share?.from ?? null, plan, limits: limitsTotal, obligations, balance, lines };
  if (input.allocation === undefined)
    return {
      kind: "ok",
      value: {
        ...base,
        choice: balance === null || input.chosen === undefined ? null : allocationChoice(balance, chosen),
        cells: [],
      },
    };
  // FR 15: no difference — nothing can be checked against N, so nothing is saved as allocated.
  if (balance === null || lines === null)
    return { kind: "invalid", issues: [{ field: "allocation", issue: "balance_unknown" }] };
  const rows = checkAllocation(balance, period, input.allocation, lines, (field, m) =>
    parseBudgetAmount(field, m, currency),
  );
  if (rows.kind === "invalid") return rows;
  return { kind: "ok", value: { ...base, choice: rows.value.choice, cells: rows.value.cells } };
}

/** What «Можна витратити в <місяць> ≈ M» needs that is not known; the figure is null while any is. */
export const SPENDABLE_MISSING = ["obligations", "rates"] as const;
export type SpendableMissing = (typeof SPENDABLE_MISSING)[number];

export interface WizardSpendable {
  readonly period: Period;
  /** Null — a source is missing (`missing`): never a figure without it. */
  readonly amount: Money | null;
  readonly missing: readonly SpendableMissing[];
}

/**
 * FR 3, AC6: «Можна витратити в <місяць> ≈ M» of the plan not saved yet — BUD-03 FR 2 (`spendable`) for the first
 * period as it would start: the current month as of today, or the next month as of its 1st. Either way the period's
 * facts on `accountIds` (the accounts the budget would take) are read by the rule of «Можна витратити»
 * (`spendableAmounts`, #661): what is already dated into it — this month's income and spending so far, or a share «На
 * кілька місяців» dated into the next month. What is contributed to goals this month counts in the current month only;
 * the regular incomes still expected as `BudgetObligations` gives them. The goals' planned contributions are
 * «Розподіл»'s cells, else the required ones (BUD-03 FR 6, `goalContributions`); the planned expenses are the payoff
 * plans' extra payments, a debt's cell in its place (`plannedDebtExpenses`). While `budget.plan` is off the cells act
 * nowhere, as on the card (#665). Null with what is missing — never a partial figure.
 */
export async function wizardSpendable(
  deps: Pick<BudgetDeps, "today" | "reads" | "planSources" | "planEnabled">,
  householdId: string,
  a: AllocationPlan,
  accountIds: readonly string[],
  categories: ReadonlyMap<string, BudgetCategory>,
): Promise<WizardSpendable> {
  const today = deps.today();
  const currency = a.plan.incomePlan.currency;
  const zero = Money.zero(currency);
  const current = a.period === periodOf(today);
  const sources = deps.planSources;
  const [goals, extra, counted, planOn] = await Promise.all([
    a.lines?.goals ?? (sources ? sources.goals(householdId, currency) : []),
    sources ? sources.extraPayments(householdId, a.period, currency) : [],
    spendableAmounts(deps, householdId, accountIds, a.period, currency, a.from ?? undefined),
    deps.planEnabled(householdId),
  ]);
  // BUD-17 business rules (owner decision 2026-11-20, batch 2, item 2; #665): «Розподіл»'s rows are saved as cells of
  // «План», and while `budget.plan` is off they act nowhere (`planCellsInEffect`) — nor in «≈ M», so it is the card's
  // figure after saving.
  const cells = planOn ? a.cells.map((c) => ({ ...c, period: a.period })) : [];
  // BUD-03 FR 6: less what is contributed this month (null — no rate: no figure) — nothing yet in a month to come;
  // a test's port without `contributed` — nothing.
  const contributions = goalContributions(
    a.period,
    goals.map((g) => ({ ...g, contributed: !current || g.contributed === undefined ? zero : g.contributed })),
    cells,
    currency,
  );
  const incomeExpected = a.obligations?.incomeExpected;
  const missing = new Set<SpendableMissing>();
  if (a.obligations === null) missing.add("obligations");
  if (counted.unavailableCount > 0 || extra === null || contributions === null || incomeExpected === null)
    missing.add("rates");
  if (missing.size > 0 || a.obligations === null || contributions === null || extra === null)
    return { period: a.period, amount: null, missing: SPENDABLE_MISSING.filter((m) => missing.has(m)) };
  const expenses = plannedDebtExpenses(
    a.period,
    extra,
    a.lines?.debtAccountIds ?? new Set(extra.map((e) => e.accountId)),
    cells,
    currency,
  );
  const figures = periodFigures(a.plan, categories, counted.amounts);
  const result = spendable({
    today: current ? today : periodDays(a.period).from,
    period: a.period,
    incomePlan: a.plan.incomePlan,
    incomeActual: figures.totals.incomeActual ?? zero,
    // BUD-03 FR 3: the regular incomes still expected (all of a month to come); a test's port without — none.
    incomeExpected: incomeExpected ?? zero,
    lines: figures.lines,
    outsidePlan: figures.totals.outsidePlan ?? zero,
    obligations: a.obligations,
    // As «Можна витратити» (#641): what is contributed this month and what is still planned.
    goalContributions: contributions.total.plus(contributions.contributed),
    plannedExpenses: expenses.total,
    plannedSavings: contributions.plannedSavings,
  });
  return { period: a.period, amount: result.amount, missing: [] };
}

/**
 * BUD-03@PoC FR 2, EC5 (#661): the period's facts «Можна витратити» counts, on `accountIds` — what is dated into the
 * period (a share «На кілька місяців» in its month; a proportional first period from `from`), less the transactions
 * written off from a goal («Витратити з цілі»). One rule for the card and the wizard's «≈ M», so the wizard's figure of
 * the next month is what the card shows on its 1st.
 */
export function spendableAmounts(
  deps: Pick<BudgetDeps, "reads">,
  householdId: string,
  accountIds: readonly string[],
  period: Period,
  currency: string,
  from: string | undefined,
): ReturnType<BudgetDeps["reads"]["amounts"]> {
  return deps.reads.amounts(householdId, accountIds, period, currency, from, undefined, {
    withoutGoalSpends: true,
  });
}
