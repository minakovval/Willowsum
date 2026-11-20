import { CurrencyMismatchError, Money } from "@willowsum/domain-kernel";
import type { BudgetIssue, LimitLine } from "./budget.ts";

/**
 * Pure rules of «Розподіл» and the totals row of «Категорії» (BUD-02@PoC c; wave 2 row 31): the bar of the limits step
 * (FR 3, AC6), the surplus or deficit of «Розподіл» (FR 15, AC6, AC7) and the four numbers over the categories table
 * (FR 19, AC9). Exact Decimal sums in the budget's one currency (FR 1); nothing here rounds. No I/O.
 */

/**
 * What the month owes outside the limits, in the budget's currency (port `BudgetObligations`): the regular payments
 * expected in the month — each with its category (null — none) and whether it is paid — and the minimum payments of the
 * debts, each with whether the month's payment is made. A «Кредит» account's monthly payment goes in `debtMinimums`,
 * never in `recurring` too (lead decision, #567): «Розподіл» counts it once as a minimum payment (FR 15), and
 * «Можна витратити» adds it once while unpaid (BUD-03 п. 2, 5) — it is not in D (FR 19: only mandatory categories),
 * «регулярні платежі поза лімітами» (FR 3) or «Очікувані платежі» (FR 16, by category). `approximate` — some amount at the nearest rate («приблизно»).
 */
export interface PeriodObligations {
  readonly recurring: readonly {
    readonly categoryId: string | null;
    readonly amount: Money;
    readonly paid: boolean;
    /**
     * BUD-03@PoC FR 5, FR 8: the charge's payment, date, and «Прострочено на N дн.» (null — not overdue) — the list of the
     * breakdown. Left out by a test's port only.
     */
    readonly paymentId?: string;
    readonly dueOn?: string;
    readonly overdueDays?: number | null;
  }[];
  readonly debtMinimums: readonly {
    readonly accountId: string;
    readonly amount: Money;
    readonly paid: boolean;
  }[];
  readonly approximate?: boolean;
  /**
   * BUD-03@PoC FR 3: the regular incomes still expected in the month («Очікується», «Прострочено»), summed — added to the
   * actual income against the plan. Null — one has no rate (no figure of «Можна витратити»); left out (a test's port) —
   * none.
   */
  readonly incomeExpected?: Money | null;
  /** BUD-03@PoC EC4 «приблизно»: an income of `incomeExpected` at the nearest rate; left out — exact. */
  readonly incomeApproximate?: boolean;
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
  /**
   * FR 15 (owner decision 2026-11-20, Q5 а): the goals' planned contributions of the month, as «План» plans them (BUD-17
   * FR 1: the required contribution up to the month of the goal's date) — «Розподіл» subtracts them too, so its figures
   * and the grid's «Не розподілено» match.
   */
  readonly goalContributions: Money;
  /** FR 15: plan of income − limits − regular payments outside limits − minimum debt payments − goal contributions. */
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
  /** Q5 а: the goals' planned contributions of the month (`plannedContributions`); none — 0. */
  readonly goalContributions?: Money;
}): AllocationBalance {
  const currency = input.incomePlan.currency;
  const o = input.obligations;
  const goals = input.goalContributions ?? Money.zero(currency);
  assertCurrency(currency, [
    goals,
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
  const difference = unallocated.minus(debtMinimums).minus(goals);
  return {
    incomePlan: input.incomePlan,
    limits,
    recurringOutsideLimits: recurring,
    unallocated,
    debtMinimums,
    goalContributions: goals,
    difference,
    kind: difference.isZero() ? "balanced" : difference.isNegative() ? "deficit" : "surplus",
    amount: difference.isNegative() ? difference.negated() : difference,
  };
}

export interface AllocationChoice {
  /**
   * The sum of the amounts chosen on the step: surplus rows, or the options that cover the deficit. A typed `goal` row
   * counts as its change against the goal's planned contribution (Q5 а), so it is below 0 when goals get less.
   */
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
  /** Σ max(0, L − S) of the mandatory categories: their unspent limits alone, without the regular payments. */
  readonly mandatoryRemaining: Money;
  /** BUD-03 FR 14: Σ max(0, L − S − U_c) of the mandatory categories — the «Обов'язкові» row of «Можна витратити». */
  readonly mandatoryRest: Money;
  /**
   * Every unpaid regular payment of the month and every unpaid monthly payment of a loan (BUD-03 п. 2, п. 5); null — the
   * source is not known or the month is past.
   */
  readonly unpaidRecurring: Money | null;
  /**
   * D = Σ over mandatory categories of max(0, L − S − U_c) + U_c (BUD-02 FR 19), i.e. Σ max(0, L − S, U_c) — only the
   * mandatory categories' own unpaid payments; null while `unpaidRecurring` is.
   */
  readonly mandatoryNeeded: Money | null;
  /** E = B − A − D; negative shows with «−». Null while D is. */
  readonly free: Money | null;
}

/**
 * FR 19, AC9: the totals row over the categories table of a period with fact. D: each mandatory category's unspent
 * rest less its own unpaid payments, never below 0, plus those payments — so a mandatory category needs the bigger of
 * its rest and its unpaid payments, and an overspent one still needs its unpaid payments. `mandatoryRest` is the
 * «Обов'язкові» row of «Можна витратити» (BUD-03 п. 14); its other unpaid payments are `unpaidRecurring`. `obligations` null — the
 * regular payments are not known (or the month is past): D and E are null, the rest is exact.
 */
export function categoriesSummary(
  lines: readonly LimitLine[],
  currency: string,
  obligations: PeriodObligations | null,
): CategoriesSummary {
  assertCurrency(currency, [
    ...lines.flatMap((l) => [l.limit, ...(l.spent ? [l.spent] : []), ...(l.remaining ? [l.remaining] : [])]),
    ...(obligations?.recurring.map((r) => r.amount) ?? []),
    ...(obligations?.debtMinimums.map((d) => d.amount) ?? []),
  ]);
  const zero = Money.zero(currency);
  const remaining = (l: LimitLine) => l.remaining ?? l.limit;
  const over = lines.filter((l) => remaining(l).isNegative());
  const mandatory = lines.filter((l) => l.mandatory);
  const mandatoryRemaining = sum(
    mandatory.map((l) => (remaining(l).isNegative() ? zero : remaining(l))),
    currency,
  );
  const unpaid = obligations?.recurring.filter((r) => !r.paid) ?? [];
  const unpaidIn = new Map<string, Money>();
  for (const r of unpaid)
    if (r.categoryId !== null)
      unpaidIn.set(r.categoryId, (unpaidIn.get(r.categoryId) ?? zero).plus(r.amount));
  const unpaidRecurring =
    obligations === null
      ? null
      : sum(
          [
            ...unpaid.map((r) => r.amount),
            // BUD-03 п. 5: a loan's monthly payment, once, while the month has no payment to the account.
            ...obligations.debtMinimums.filter((d) => !d.paid).map((d) => d.amount),
          ],
          currency,
        );
  // BUD-03 п. 14: max(0, L − S − U_c) — the category's own unpaid payments are in `unpaidRecurring` already.
  const mandatoryPart = sum(
    mandatory.map((l) => {
      const rest = remaining(l).minus(unpaidIn.get(l.categoryId) ?? zero);
      return rest.isNegative() ? zero : rest;
    }),
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
  // BUD-02 FR 19: D = Σ over mandatory categories of max(0, L − S − U_c) + U_c — only the mandatory categories' own
  // unpaid payments; a payment of an optional category, without a category or a loan's is not «на обов'язкові».
  const mandatoryOwnUnpaid = sum(
    mandatory.map((l) => unpaidIn.get(l.categoryId) ?? zero),
    currency,
  );
  const mandatoryNeeded = unpaidRecurring === null ? null : mandatoryPart.plus(mandatoryOwnUnpaid);
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
    mandatoryRest: mandatoryPart,
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

/**
 * FR 15 (saved with the budget): the typed rows of «Розподіл». A surplus — `goal` (the goal's planned contribution of
 * the first period), `debt` (the extra payment above the minimum for one debt, a planned expense), `savings`
 * («Заощадження без цілі»); what is not chosen stays «Не розподілено» («Лишити нерозподіленим» — no row). A deficit —
 * `from-goal` («З цілі …»: the goal's contribution of the month is lowered by the amount). «Зменшити ліміти» is lower
 * `limits`, never a row. `from-savings` («Із заощаджень») and `to-debt` («У борг») are refused as `not_saved`: in PoC
 * they are not saved (owner decision 2026-11-20, Q3 а).
 */
export const ALLOCATION_ROW_KINDS = ["goal", "debt", "savings", "from-goal"] as const;
export const UNSAVED_ROW_KINDS = ["from-savings", "to-debt"] as const;
export type AllocationRowKind = (typeof ALLOCATION_ROW_KINDS)[number] | (typeof UNSAVED_ROW_KINDS)[number];

/** The most rows one «Розподіл» saves. */
export const ALLOCATION_ROWS_MAX = 100;

export interface AllocationRowInput {
  readonly kind: AllocationRowKind;
  /** `goal`, `from-goal`: the goal (module goals). */
  readonly goalId?: string | undefined;
  /** `debt`: the debt's account (module accounts). */
  readonly accountId?: string | undefined;
  readonly amount: { readonly amount: string; readonly currency: string };
}

/** The lines a row may name: the space's active goals and the debts the first period owes (as «План» reads them). */
export interface AllocationLines {
  readonly goals: readonly {
    readonly goalId: string;
    /** Null — no required contribution (no date, past it) or no rate. */
    readonly required: Money | null;
    readonly lastPeriod: string | null;
    /** The goal's own currency; the wizard shows only the goals in the budget's currency (Q4 а). */
    readonly currency?: string | undefined;
    /** BUD-03@PoC FR 6: contributed this calendar month; null — no rate; left out — nothing («Можна витратити»). */
    readonly contributed?: Money | null | undefined;
  }[];
  readonly debtAccountIds: ReadonlySet<string>;
}

/** A cell of the first period «Розподіл» writes into «План» (BUD-17): the month's own value of its line. */
export interface AllocationCell {
  readonly kind: "goal" | "savings" | "debt";
  readonly lineId: string | null;
  readonly amount: Money;
}

export interface CheckedAllocation {
  readonly cells: readonly AllocationCell[];
  readonly choice: AllocationChoice;
}

/** FR 15: a goal's planned contribution of `period` by default — the required one up to the month of its date. */
export function defaultContribution(goal: AllocationLines["goals"][number], period: string): Money | null {
  return goal.required !== null && goal.lastPeriod !== null && goal.lastPeriod >= period
    ? goal.required
    : null;
}

/**
 * Q5 а: Σ the goals' default contributions of `period` (BUD-17 FR 1); null — a goal with a date ahead has no figure
 * (no rate), as the grid's section then has no total.
 */
export function plannedContributions(
  goals: AllocationLines["goals"],
  period: string,
  currency: string,
): Money | null {
  let total = Money.zero(currency);
  for (const g of goals) {
    if (g.required === null && g.lastPeriod !== null && g.lastPeriod >= period) return null;
    const d = defaultContribution(g, period);
    if (d) total = total.plus(d);
  }
  return total;
}

const SURPLUS_KINDS: ReadonlySet<AllocationRowKind> = new Set(["goal", "debt", "savings"]);
const UNSAVED: ReadonlySet<AllocationRowKind> = new Set(UNSAVED_ROW_KINDS);

/**
 * FR 15, AC6, AC7: the rows of «Розподіл» checked against the balance with the rules of the calculation
 * (`allocationChoice`): each row of the balance's kind, on a goal or debt of the space, once, ≥ 0 exactly in the
 * budget's currency; the sum never over N (`over`); a deficit covered exactly (`short` refused). The balance already
 * holds the goals' default contributions (Q5 а), so a `goal` row counts as its change against that default, and a goal
 * the wizard shows (budget currency, a contribution planned) left without a row is saved as 0 € (Q4 а). So the grid's
 * «Не розподілено» after the save is the rest. Returns the cells the first period stores, or the issues.
 */
export function checkAllocation(
  balance: AllocationBalance,
  period: string,
  rows: readonly AllocationRowInput[],
  lines: AllocationLines,
  parse: (
    field: string,
    input: { readonly amount: string; readonly currency: string },
  ) => Money | BudgetIssue,
):
  | { readonly kind: "ok"; readonly value: CheckedAllocation }
  | { readonly kind: "invalid"; readonly issues: readonly BudgetIssue[] } {
  const issues: BudgetIssue[] = [];
  const cells: AllocationCell[] = [];
  const amounts: Money[] = [];
  const seen = new Set<string>();
  const goals = new Map(lines.goals.map((g) => [g.goalId, g]));
  const currency = balance.amount.currency;
  const planned = (g: AllocationLines["goals"][number]) =>
    defaultContribution(g, period) ?? Money.zero(currency);
  rows.forEach((row, i) => {
    const field = `allocation.${i}`;
    // Q3 а: «Із заощаджень» and «У борг» are not saved in PoC — the screen says so.
    if (UNSAVED.has(row.kind)) return issues.push({ field: `${field}.kind`, issue: "not_saved" });
    const fits =
      balance.kind === "surplus"
        ? SURPLUS_KINDS.has(row.kind)
        : balance.kind === "deficit" && row.kind === "from-goal";
    if (!fits) return issues.push({ field: `${field}.kind`, issue: "invalid" });
    const idField = row.kind === "debt" ? "accountId" : row.kind === "savings" ? "kind" : "goalId";
    const lineId =
      row.kind === "debt" ? (row.accountId ?? null) : row.kind === "savings" ? null : (row.goalId ?? null);
    if (row.kind !== "savings" && lineId === null)
      return issues.push({ field: `${field}.${idField}`, issue: "required" });
    const key = `${row.kind === "from-goal" ? "goal" : row.kind}:${lineId ?? ""}`;
    if (seen.has(key)) return issues.push({ field: `${field}.${idField}`, issue: "duplicate" });
    seen.add(key);
    const goal = lineId === null ? undefined : goals.get(lineId);
    if ((row.kind === "goal" || row.kind === "from-goal") && !goal)
      return issues.push({ field: `${field}.goalId`, issue: "not_found" });
    if (row.kind === "debt" && !lines.debtAccountIds.has(lineId!))
      return issues.push({ field: `${field}.accountId`, issue: "not_found" });
    const amount = parse(`${field}.amount`, row.amount);
    if (!(amount instanceof Money)) return issues.push(amount);
    if (row.kind === "from-goal") {
      // «З цілі …» — the month's contribution lowered: never below 0, and only a goal with one planned.
      const d = defaultContribution(goal!, period);
      if (d === null) return issues.push({ field: `${field}.goalId`, issue: "no_contribution" });
      if (amount.compare(d) > 0) return issues.push({ field: `${field}.amount`, issue: "over_contribution" });
      cells.push({ kind: "goal", lineId, amount: d.minus(amount) });
      amounts.push(amount);
    } else if (row.kind === "goal") {
      cells.push({ kind: "goal", lineId, amount });
      amounts.push(amount.minus(planned(goal!)));
    } else {
      cells.push({ kind: row.kind as "debt" | "savings", lineId, amount });
      amounts.push(amount);
    }
  });
  if (issues.length > 0) return { kind: "invalid", issues };
  // Q4 а: a goal the wizard shows and left empty on a surplus is 0 € this month, not its required contribution.
  if (balance.kind === "surplus")
    for (const g of lines.goals) {
      const d = planned(g);
      if (seen.has(`goal:${g.goalId}`) || d.isZero() || (g.currency !== undefined && g.currency !== currency))
        continue;
      cells.push({ kind: "goal", lineId: g.goalId, amount: Money.zero(currency) });
      amounts.push(d.negated());
    }
  const choice = allocationChoice(balance, amounts);
  if (choice.status === "over") return { kind: "invalid", issues: [{ field: "allocation", issue: "over" }] };
  if (balance.kind === "deficit" && choice.status !== "exact")
    return { kind: "invalid", issues: [{ field: "allocation", issue: "short" }] };
  return { kind: "ok", value: { cells, choice } };
}
