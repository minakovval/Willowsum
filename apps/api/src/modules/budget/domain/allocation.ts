import { CurrencyMismatchError, Money } from "@willowsum/domain-kernel";
import type { LimitLine } from "./budget.ts";

/**
 * Pure rules of «Розподіл» and the totals row of «Категорії» (BUD-02@PoC c; wave 2 row 31): the bar of the limits step
 * (FR 3, AC6), the surplus or deficit of «Розподіл» (FR 15, AC6, AC7) and the four numbers over the categories table
 * (FR 19, AC9). Exact Decimal sums in the budget's one currency (FR 1); nothing here rounds. No I/O.
 */

/**
 * What the month owes outside the limits, in the budget's currency (port `BudgetObligations`): the regular payments
 * expected in the month — each with its category (null — none) and whether it is paid — and the minimum payments of the
 * debts.
 */
export interface PeriodObligations {
  readonly recurring: readonly {
    readonly categoryId: string | null;
    readonly amount: Money;
    readonly paid: boolean;
  }[];
  readonly debtMinimums: readonly { readonly accountId: string; readonly amount: Money }[];
}

/** FR 1: one budget — one currency; an amount of another currency is never added (no figure beats a wrong one). */
export function assertCurrency(currency: string, amounts: readonly Money[]): void {
  for (const a of amounts) if (a.currency !== currency) throw new CurrencyMismatchError();
}

const sum = (xs: readonly Money[], currency: string): Money =>
  xs.reduce((t, x) => t.plus(x), Money.zero(currency));

/** FR 3, FR 15: the regular payments of the month whose category has no limit (a limit already holds the others). */
export function recurringOutsideLimits(
  obligations: PeriodObligations,
  limitedCategoryIds: ReadonlySet<string>,
  currency: string,
): Money {
  return sum(
    obligations.recurring
      .filter((r) => r.categoryId === null || !limitedCategoryIds.has(r.categoryId))
      .map((r) => r.amount),
    currency,
  );
}

export interface AllocationBalance {
  readonly incomePlan: Money;
  readonly limits: Money;
  readonly recurringOutsideLimits: Money;
  /** FR 3, AC6: the bar of the limits step — «План доходу A − ліміти B − регулярні платежі поза лімітами C = не розподілено N». */
  readonly unallocated: Money;
  readonly debtMinimums: Money;
  /** FR 15: plan of income − limits − regular payments outside limits − minimum debt payments. */
  readonly difference: Money;
  /** FR 15: «профіцит N» (> 0), «дефіцит N» (< 0) or nothing to allocate (0). */
  readonly kind: "surplus" | "deficit" | "balanced";
  /** |difference|: the N of «профіцит N €» or «Звідки візьмуться N €?». */
  readonly amount: Money;
}

/** FR 3, FR 15, AC6, AC7: the bar of the limits step and the difference «Розподіл» starts from. */
export function allocationBalance(input: {
  readonly incomePlan: Money;
  readonly limits: readonly { readonly categoryId: string; readonly amount: Money }[];
  readonly obligations: PeriodObligations;
}): AllocationBalance {
  const currency = input.incomePlan.currency;
  const o = input.obligations;
  assertCurrency(currency, [
    ...input.limits.map((l) => l.amount),
    ...o.recurring.map((r) => r.amount),
    ...o.debtMinimums.map((d) => d.amount),
  ]);
  const limits = sum(
    input.limits.map((l) => l.amount),
    currency,
  );
  const recurring = recurringOutsideLimits(o, new Set(input.limits.map((l) => l.categoryId)), currency);
  const unallocated = input.incomePlan.minus(limits).minus(recurring);
  const debtMinimums = sum(
    o.debtMinimums.map((d) => d.amount),
    currency,
  );
  const difference = unallocated.minus(debtMinimums);
  return {
    incomePlan: input.incomePlan,
    limits,
    recurringOutsideLimits: recurring,
    unallocated,
    debtMinimums,
    difference,
    kind: difference.isZero() ? "balanced" : difference.isNegative() ? "deficit" : "surplus",
    amount: difference.isNegative() ? difference.negated() : difference,
  };
}

export interface AllocationChoice {
  /** The sum of the amounts chosen on the step: surplus rows, or the options that cover the deficit. */
  readonly chosen: Money;
  /** N − chosen: a surplus's «Не розподілено» when kept («Лишити нерозподіленим»); a deficit's part not yet covered. */
  readonly rest: Money;
  /**
   * `short` — less than N chosen: a surplus may stay unallocated, a deficit keeps «Створити бюджет» inactive;
   * `exact` — the sum equals N (a deficit is covered in full); `over` — more than N, which neither case allows.
   */
  readonly status: "short" | "exact" | "over";
}

/**
 * FR 15, AC7: the amounts chosen on «Розподіл» against N. A deficit is covered only when the chosen options sum to N
 * exactly; a surplus can be distributed up to N and the rest left unallocated. Chosen amounts are ≥ 0.
 */
export function allocationChoice(balance: AllocationBalance, chosen: readonly Money[]): AllocationChoice {
  const currency = balance.amount.currency;
  assertCurrency(currency, chosen);
  const total = sum(chosen, currency);
  const rest = balance.amount.minus(total);
  return { chosen: total, rest, status: rest.isZero() ? "exact" : rest.isNegative() ? "over" : "short" };
}

/** FR 19: «Витрачено A з B», «Перевитрата C у N категоріях», «Ще потрібно на обов'язкові D», «Вільний залишок E». */
export interface CategoriesSummary {
  /** A: spent in the categories with a limit. */
  readonly spent: Money;
  /** B: the sum of the limits. */
  readonly limits: Money;
  /** C and N: the sum of the negative remainders only, as a positive amount, and how many categories have one. */
  readonly overspend: { readonly amount: Money; readonly count: number };
  /** The sum of the limits of the optional categories: the base of the overspend shade (FR 9; DS-23). */
  readonly optionalLimits: Money;
  /** The unspent rest of the mandatory categories' limits — the limits part of D. */
  readonly mandatoryRemaining: Money;
  /** The unpaid regular payments outside the mandatory categories — the other part of D; null — source not known. */
  readonly unpaidRecurring: Money | null;
  /** D = mandatoryRemaining + unpaidRecurring, nothing counted twice; null while `unpaidRecurring` is. */
  readonly mandatoryNeeded: Money | null;
  /** E = B − A − D; negative shows with «−». Null while D is. */
  readonly free: Money | null;
}

/**
 * FR 19, AC9: the totals row over the categories table of a period with fact (current or past). D takes the unspent
 * rest of each mandatory limit (an overspent one adds 0) plus the regular payments not yet paid whose category is not a
 * mandatory one with a limit — a payment in such a category is already in its limit, so it is not counted twice.
 * `obligations` null — the regular payments are not known: D and E are null, the rest is exact.
 */
export function categoriesSummary(
  lines: readonly LimitLine[],
  currency: string,
  obligations: PeriodObligations | null,
): CategoriesSummary {
  assertCurrency(currency, [
    ...lines.flatMap((l) => [l.limit, ...(l.spent ? [l.spent] : []), ...(l.remaining ? [l.remaining] : [])]),
    ...(obligations?.recurring.map((r) => r.amount) ?? []),
  ]);
  const zero = Money.zero(currency);
  const remaining = (l: LimitLine) => l.remaining ?? l.limit;
  const over = lines.filter((l) => remaining(l).isNegative());
  const mandatory = lines.filter((l) => l.mandatory);
  const mandatoryRemaining = sum(
    mandatory.map((l) => (remaining(l).isNegative() ? zero : remaining(l))),
    currency,
  );
  const mandatoryIds = new Set(mandatory.map((l) => l.categoryId));
  const unpaidRecurring =
    obligations === null
      ? null
      : sum(
          obligations.recurring
            .filter((r) => !r.paid && (r.categoryId === null || !mandatoryIds.has(r.categoryId)))
            .map((r) => r.amount),
          currency,
        );
  const limits = sum(
    lines.map((l) => l.limit),
    currency,
  );
  const spent = sum(
    lines.map((l) => l.spent ?? zero),
    currency,
  );
  const mandatoryNeeded = unpaidRecurring === null ? null : mandatoryRemaining.plus(unpaidRecurring);
  return {
    spent,
    limits,
    // 0 − Σ: a positive amount, and «0», never «-0», without overspend.
    overspend: {
      amount: zero.minus(
        sum(
          over.map((l) => remaining(l)),
          currency,
        ),
      ),
      count: over.length,
    },
    optionalLimits: sum(
      lines.filter((l) => !l.mandatory).map((l) => l.limit),
      currency,
    ),
    mandatoryRemaining,
    unpaidRecurring,
    mandatoryNeeded,
    free: mandatoryNeeded === null ? null : limits.minus(spent).minus(mandatoryNeeded),
  };
}

/**
 * FR 16, AC8: the column «Очікувані платежі» of a month — the regular payments expected in it by category (null —
 * none), in the order first met, and their total.
 */
export function expectedPayments(
  obligations: PeriodObligations,
  currency: string,
): {
  readonly categories: readonly { readonly categoryId: string | null; readonly amount: Money }[];
  readonly total: Money;
} {
  assertCurrency(
    currency,
    obligations.recurring.map((r) => r.amount),
  );
  const by = new Map<string | null, Money>();
  for (const r of obligations.recurring)
    by.set(r.categoryId, (by.get(r.categoryId) ?? Money.zero(currency)).plus(r.amount));
  return {
    categories: [...by.entries()].map(([categoryId, amount]) => ({ categoryId, amount })),
    total: sum(
      obligations.recurring.map((r) => r.amount),
      currency,
    ),
  };
}
