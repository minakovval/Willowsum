import { Money } from "@willowsum/domain-kernel";
import {
  allocationBalance,
  allocationChoice,
  firstPeriodChoices,
  isPeriod,
  parseBudgetAmount,
  scalePlan,
  shareFrom,
  startChoices,
  type AllocationBalance,
  type AllocationChoice,
  type BudgetCategory,
  type BudgetIssue,
  type Period,
} from "../domain/index.ts";
import { checkLimits, type BudgetDeps, type LimitInput, type Result } from "./budget.ts";

type MoneyInput = { readonly amount: string; readonly currency: string };

/** The most amounts «Розподіл» sums in one request (goals, debts, «Заощадження без цілі», deficit options). */
export const CHOSEN_MAX = 100;

export interface AllocationPreview {
  readonly period: Period;
  /** The plan the figures use: × the share of days for a proportional first period (FR 14). */
  readonly incomePlan: Money;
  readonly limits: Money;
  /** Null — the regular payments and debts are not connected yet (`BudgetObligations`). */
  readonly balance: AllocationBalance | null;
  /** Null without `chosen` or without the balance. */
  readonly choice: AllocationChoice | null;
}

/**
 * FR 3, FR 15, AC6, AC7: the bar of the limits step and the surplus or deficit of «Розподіл» for the plan the wizard
 * holds (not saved yet): the start as POST /v1/budget takes it (`firstPeriod`, `proportional`), the income plan, the
 * limits, and optionally the amounts chosen on the step. Read only: nothing is saved, nothing is moved.
 */
export async function previewAllocation(
  deps: Pick<BudgetDeps, "today" | "reportingCurrency" | "obligations">,
  householdId: string,
  input: {
    readonly firstPeriod: string;
    readonly proportional?: boolean | undefined;
    readonly incomePlan?: MoneyInput | undefined;
    readonly limits?: readonly LimitInput[] | undefined;
    readonly chosen?: readonly MoneyInput[] | undefined;
  },
  categories: ReadonlyMap<string, BudgetCategory>,
): Promise<Result<AllocationPreview>> {
  const currency = deps.reportingCurrency;
  const today = deps.today();
  const issues: BudgetIssue[] = [];
  if (!isPeriod(input.firstPeriod) || !firstPeriodChoices(today).includes(input.firstPeriod))
    issues.push({ field: "firstPeriod", issue: "invalid" });
  const proportional = startChoices(today).choices.find((c) => c.start === "proportional");
  if (input.proportional === true && proportional?.firstPeriod !== input.firstPeriod)
    issues.push({ field: "proportional", issue: "invalid" });
  const income = input.incomePlan
    ? parseBudgetAmount("incomePlan", input.incomePlan, currency)
    : Money.zero(currency);
  if (!(income instanceof Money)) issues.push(income);
  const checked = checkLimits(input.limits ?? [], categories, currency);
  issues.push(...checked.issues);
  const chosen: Money[] = [];
  (input.chosen ?? []).forEach((c, i) => {
    const m = parseBudgetAmount(`chosen.${i}`, c, currency);
    if (m instanceof Money) chosen.push(m);
    else issues.push(m);
  });
  if (issues.length > 0 || !(income instanceof Money)) return { kind: "invalid", issues };
  const limits = checked.limits.flatMap((l) => (l.amount === null ? [] : [{ ...l, amount: l.amount }]));
  // FR 14: a proportional first period — the plan × (days left, today included) ÷ (days in the period).
  const share = input.proportional === true ? shareFrom(today) : null;
  const plan = {
    incomePlan: income,
    plannedSavings: Money.zero(currency),
    limits: limits.map((l) => ({ ...l, mandatory: false })),
  };
  const scaled = share ? scalePlan(plan, share) : plan;
  const scaledLimits = scaled.limits.map((l) => ({ categoryId: l.categoryId, amount: l.amount }));
  const limitsTotal = scaledLimits.reduce((t, l) => t.plus(l.amount), Money.zero(currency));
  if (deps.obligations === null)
    return {
      kind: "ok",
      value: {
        period: input.firstPeriod,
        incomePlan: scaled.incomePlan,
        limits: limitsTotal,
        balance: null,
        choice: null,
      },
    };
  const obligations = await deps.obligations.month(householdId, input.firstPeriod, currency, share?.from);
  const balance = allocationBalance({ incomePlan: scaled.incomePlan, limits: scaledLimits, obligations });
  return {
    kind: "ok",
    value: {
      period: input.firstPeriod,
      incomePlan: scaled.incomePlan,
      limits: limitsTotal,
      balance,
      choice: input.chosen === undefined ? null : allocationChoice(balance, chosen),
    },
  };
}
