import { isCurrencyCode, Money } from "@willowsum/domain-kernel";
import {
  convertLines,
  firstPeriodChoices,
  withLateRates,
  withPlanRates,
  inBudgetCurrency,
  incomePlanIssue,
  incomePlansTotal,
  includedByDefault,
  isPeriod,
  limitIssue,
  periodDays,
  periodOf,
  parseBudgetAmount,
  parseCategoryAmount,
  periodMode,
  periodsToSnapshot,
  scalePlan,
  shareFrom,
  startChoices,
  withCells,
  type AllocationCell,
  type BudgetCategory,
  type BudgetIssue,
  type CountedAmount,
  type Period,
  type PeriodObligations,
  type PeriodPlan,
  type PlanCell,
  type PlanRates,
  type PlanLines,
} from "../domain/index.ts";

/** The space's budget as stored (migrations/0001_budget.sql). */
export interface StoredBudget {
  readonly id: string;
  readonly currency: string;
  readonly firstPeriod: Period;
  readonly incomePlan: Money;
  readonly createdOn: string;
  readonly version: number;
  /** FR 14: the day a proportional first period starts (today when created); null — the whole first period. */
  readonly firstDay: string | null;
}

export interface StoredLimit {
  readonly categoryId: string;
  readonly amount: Money;
}

/** The budget schema inside one transaction of the module (adapters/db/store.ts). */
export interface BudgetTx {
  /** `lock` — under a row lock until the commit: every change of the budget is serialised on it. */
  budget(householdId: string, lock?: boolean): Promise<StoredBudget | null>;
  /** False when the space already has a budget (FR 1): nothing is written. */
  insertBudget(householdId: string, budget: StoredBudget): Promise<boolean>;
  /** Writes the income plan and bumps the version. */
  updateBudget(householdId: string, id: string, incomePlan: Money): Promise<StoredBudget>;
  /** FR 13: with its limits, account choices and snapshots. */
  deleteBudget(householdId: string, id: string): Promise<void>;
  limits(householdId: string, budgetId: string): Promise<StoredLimit[]>;
  /** Null removes the limit: the category goes to «Поза планом». */
  setLimit(householdId: string, budgetId: string, categoryId: string, amount: Money | null): Promise<void>;
  /** FR 21: the income plan of each income category (migrations/0007_income_plans.sql). */
  incomePlans(householdId: string, budgetId: string): Promise<StoredLimit[]>;
  /** Null removes the category from «План доходу». */
  setIncomePlan(
    householdId: string,
    budgetId: string,
    categoryId: string,
    amount: Money | null,
  ): Promise<void>;
  /** FR 10: the accounts switched away from their default. */
  accountChoices(householdId: string): Promise<ReadonlyMap<string, boolean>>;
  /** Null — back to the account's default. */
  setAccountChoice(
    householdId: string,
    budgetId: string,
    accountId: string,
    included: boolean | null,
  ): Promise<void>;
  /** The snapshots of the given periods (all when omitted). */
  snapshots(householdId: string, budgetId: string): Promise<ReadonlyMap<Period, PeriodPlan>>;
  insertSnapshot(householdId: string, budgetId: string, period: Period, plan: PeriodPlan): Promise<void>;
  /**
   * FR 11, FR 24 (#709): writes the lines and rates of a snapshot whose missing rate has appeared (`withLateRates`);
   * nothing else of it changes.
   */
  updateSnapshotRates(householdId: string, budgetId: string, period: Period, plan: PeriodPlan): Promise<void>;
  /** BUD-17 FR 2: the months' own values of the grid's lines (from `from` on when given), oldest first. */
  planCells(householdId: string, budgetId: string, from?: Period): Promise<PlanCell[]>;
  /** Writes a cell (`amount` null — back to the line's default) and returns its new version. */
  setPlanCell(
    householdId: string,
    budgetId: string,
    cell: Omit<PlanCell, "version">,
    currency: string,
  ): Promise<number>;
  /**
   * BUD-01@PoC FR 12, AC22: removes every month's own value of the line (`kind` «limit» or «income», the category) and returns the
   * cells removed.
   */
  deletePlanCells(
    householdId: string,
    budgetId: string,
    kind: "limit" | "income",
    lineId: string,
  ): Promise<PlanCell[]>;
  enqueueHandOff(handOff: BudgetHandOff): Promise<void>;
}

/** An account of the space as the tab «Рахунки бюджету» lists it (module accounts). */
export interface BudgetAccount {
  readonly accountId: string;
  readonly kind: string;
  readonly status: "active" | "closed";
}

/** What the budget reads from other modules, outside its own transaction (their pools). */
export interface BudgetReads {
  /** The space's category tree (module categories). */
  categories(householdId: string): Promise<BudgetCategory[]>;
  /** Every account of the space, closed ones too (module accounts). */
  accounts(householdId: string): Promise<BudgetAccount[]>;
  /**
   * FR 12, business rules: what the transactions of these accounts count in the period, in `currency` at the rate of
   * each one's date (modules transactions, categorization, fx-rates). `nearestRateCount` — converted at the nearest
   * available rate («приблизно»); `unavailableCount` — no rate at all, left out until one comes («Курс недоступний»).
   */
  amounts(
    householdId: string,
    accountIds: readonly string[],
    period: Period,
    currency: string,
    /** FR 14: a proportional first period counts from this day (a share «На кілька місяців» — the whole month). */
    from?: string,
    /** BUD-06: the last day counted when a window ends inside the month (a share — still the whole month's). */
    until?: string,
    /**
     * BUD-03@PoC EC5, BUD-05@PoC FR 8: leave out the transactions written off from a goal («Витратити з цілі») — they no
     * longer lower «Можна витратити». Only that sum asks it; «Бюджет», «Порівняння» and the snapshot count them.
     */
    options?: {
      readonly withoutGoalSpends?: boolean;
    },
  ): Promise<{
    /**
     * `oneOff` (BUD-06@PoC FR 8): the amount's transaction is marked «Одноразова витрата» — in the fact; an average
     * (the wizard) leaves it out itself.
     */
    readonly amounts: readonly (CountedAmount & { readonly oneOff?: boolean })[];
    readonly nearestRateCount: number;
    readonly unavailableCount: number;
  }>;
  /**
   * BUD-06@PoC FR 1: what the transactions of these accounts count from `from` to `to` (dates, inclusive) — as `amounts`
   * for each month, a share «На кілька місяців» in its month when the 1st of it is in the dates; each amount with its
   * month. One read and one cap (#586) for the whole window. `oneOff` (BUD-06@PoC FR 8): the amount's transaction is
   * marked «Одноразова витрата» — in the fact, out of an average (the reader leaves it out).
   */
  window(
    householdId: string,
    accountIds: readonly string[],
    from: string,
    to: string,
    currency: string,
  ): Promise<{
    readonly amounts: readonly (CountedAmount & { readonly period: Period; readonly oneOff?: boolean })[];
    readonly nearestRateCount: number;
    readonly unavailableCount: number;
  }>;
  /** BUD-06@PoC FR 4, FR 5: the date of the first counted transaction of these accounts; null — none. */
  historyStart(householdId: string, accountIds: readonly string[]): Promise<string | null>;
}

/**
 * FR 3, FR 15, FR 16, FR 19 (BUD-03 FR 5): what a month owes outside the limits, in `currency`: the regular payments
 * expected in the month — from `from` on for a proportional first period — and the loans' monthly payments
 * (adapters/obligations.ts over modules recurring, accounts, liabilities and transactions; #567). Null — an amount
 * without any rate or out of range: every figure that needs it is null, never a sum without it.
 */
export interface BudgetObligations {
  month(
    householdId: string,
    period: Period,
    currency: string,
    from?: string,
  ): Promise<PeriodObligations | null>;
}

/**
 * FLW-38@PoC FR 1 (S-135 «Підсумок періоду»): the regular charges of a finished month of every payment, whatever its
 * state now, with their status and the day each was paid (module recurring's `RecurringHistory`). Amounts in the
 * payment's currency.
 */
export interface BudgetChargeHistory {
  finishedMonth(
    householdId: string,
    month: Period,
  ): Promise<
    readonly {
      readonly paymentId: string;
      readonly type: "expense" | "income";
      readonly categoryId: string | null;
      readonly dueOn: string;
      readonly expected: Money;
      readonly status: "paid" | "paid-late" | "expected" | "overdue" | "skipped";
      readonly overdueDays: number | null;
      readonly paidOn: string | null;
    }[]
  >;
}

/**
 * BUD-02@PoC FR 24 («Валюта категорії»): the rate of each currency into `to` on `date` — the date's or the nearest
 * earlier one (module fx-rates, adapters/plan-rates.ts). A currency left out of the map has no rate at all.
 */
export interface BudgetRates {
  rates(currencies: readonly string[], to: string, date: string): Promise<PlanRates>;
}

export interface BudgetDeps {
  readonly newId: () => string;
  /** «Сьогодні» — the Kyiv date. */
  readonly today: () => string;
  /** The space's reporting currency (ACC-06): the budget's, fixed when it is created (FR 1). */
  readonly reportingCurrency: string;
  readonly reads: BudgetReads;
  /**
   * FR 24: the rates the limits and income plans of other currencies are converted at; null or left out — not wired (a
   * test's server): such a currency is refused and a stored line of one counts 0 («Курс недоступний»).
   */
  readonly rates?: BudgetRates | null;
  /** Null — not wired (a test's server only; the API process wires it). */
  readonly obligations: BudgetObligations | null;
  /** BUD-17: the goals and the debts' extra payments of the grid; null — not wired (a test's server only). */
  readonly planSources: BudgetPlanSources | null;
  /** FLW-38 (S-135): a finished month's regular charges; null or left out — not wired (a test's server only). */
  readonly chargeHistory?: BudgetChargeHistory | null;
  /**
   * BUD-17 business rules (owner decision 2026-11-20, batch 2, item 2): whether «План» (release flag `budget.plan`) is
   * on for the space. While it is off the months' own values typed on «План» act nowhere (`planCellsInEffect`); they
   * stay stored. Required, so that the wiring in main.ts cannot be left out silently (#652 security review).
   */
  readonly planEnabled: (householdId: string) => Promise<boolean>;
}

/**
 * BUD-17@PoC FR 1: what «План» reads from modules goals and debt-payoff (adapters/plan-sources.ts), in `currency` at
 * today's rate. A goal's `required` is null without a rate; a month's extra payments are null when one has no rate.
 */
export interface BudgetPlanSources {
  /** The space's active goals, oldest first. */
  goals(
    householdId: string,
    currency: string,
  ): Promise<
    readonly {
      goalId: string;
      required: Money | null;
      lastPeriod: Period | null;
      /** BUD-03@PoC FR 6: contributed this calendar month; null — no rate; left out (a test's port) — nothing. */
      contributed?: Money | null;
      /** BUD-03@PoC EC4 «приблизно»: `required` / `contributed` at the nearest rate; left out — exact. */
      requiredApproximate?: boolean;
      contributedApproximate?: boolean;
      /** The goal's own currency (BUD-02 FR 15, Q4 а: the wizard shows the goals in the budget's currency). */
      currency?: string;
    }[]
  >;
  /** BUD-19 FR 5: the extra payments of the saved payoff plans in the month, by debt. */
  extraPayments(
    householdId: string,
    period: Period,
    currency: string,
  ): Promise<
    | readonly {
        accountId: string;
        amount: Money;
        /** BUD-03@PoC EC4 «приблизно»: at the nearest rate; left out — exact. */
        approximate?: boolean;
      }[]
    | null
  >;
}

export interface Caller {
  readonly householdId: string;
  readonly accountId: string;
}

export type Result<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "invalid"; readonly issues: readonly BudgetIssue[] }
  | { readonly kind: "not-found" }
  /** Edge case 6: «Бюджет уже існує». */
  | { readonly kind: "exists" }
  /** «Бюджет змінено в іншому вікні, оновіть сторінку». */
  | { readonly kind: "conflict"; readonly version: number };

/** A change and its audit hand-off, written in one budget transaction (ARC-04 FR 2; ADR-0015). */
export interface Handed<R> {
  readonly result: R;
  readonly handOffs: readonly BudgetHandOff[];
}

export const BUDGET_HAND_OFF_ACTIONS = ["create", "update", "delete"] as const;
export const BUDGET_AUDIT_ENTITIES = [
  "budget.budget",
  "budget.limit",
  "budget.account",
  "budget.plan-cell",
  "budget.income-plan",
] as const;

/**
 * The hand-off of a budget change to the audit log («Кожна зміна пишеться в журнал аудиту зі значеннями до і після»;
 * ARC-04 FR 2, FR 3; ADR-0015): the row and this job in one budget transaction, the entry after the commit — right away
 * and by the worker if that failed — once per key. It carries the values: ids, periods, amounts as decimal strings.
 */
export interface BudgetHandOff {
  readonly entity: (typeof BUDGET_AUDIT_ENTITIES)[number];
  /** The budget, the limit's category, the account, or a cell's line (its category or goal; the budget for none). */
  readonly entityId: string;
  readonly actorAccountId: string;
  readonly action: (typeof BUDGET_HAND_OFF_ACTIONS)[number];
  readonly changeId: string;
  readonly changes: readonly {
    readonly field: string;
    readonly before: string | null;
    readonly after: string | null;
  }[];
}

export const handOffKey = (h: BudgetHandOff): string => `${h.entity}:${h.action}:${h.entityId}:${h.changeId}`;

function handOff(
  deps: Pick<BudgetDeps, "newId">,
  caller: Caller,
  entity: BudgetHandOff["entity"],
  entityId: string,
  action: BudgetHandOff["action"],
  changes: BudgetHandOff["changes"],
): BudgetHandOff {
  return { entity, entityId, actorAccountId: caller.accountId, action, changeId: deps.newId(), changes };
}

const budgetFields = (b: StoredBudget) => ({
  currency: b.currency,
  firstPeriod: b.firstPeriod,
  incomePlan: b.incomePlan.toDecimalString(),
  ...(b.firstDay === null ? {} : { firstDay: b.firstDay }),
});

const limitChange = (
  categoryId: string,
  before: Money | null,
  after: Money | null,
  /** FR 24: the budget's currency — a line of another currency on either side also names its currency. */
  currency?: string,
) => [
  { field: "categoryId", before: before ? categoryId : null, after: after ? categoryId : null },
  { field: "amount", before: before?.toDecimalString() ?? null, after: after?.toDecimalString() ?? null },
  ...(currency !== undefined && [before, after].some((m) => m !== null && m.currency !== currency)
    ? [{ field: "currency", before: before?.currency ?? null, after: after?.currency ?? null }]
    : []),
];

/** The most limits one request sets. */
export const LIMITS_MAX = 300;

/** The most income categories one request plans (FR 21). */
export const INCOME_PLANS_MAX = 100;

export interface IncomePlanInput {
  readonly categoryId: string;
  /** Null — «Прибрати» (✕): the category leaves «План доходу». */
  readonly amount: { readonly amount: string; readonly currency: string } | null;
}

/** FR 21: each income plan of an active income category of the space, once, ≥ 0 in the budget's currency. */
export function checkIncomePlans(
  inputs: readonly IncomePlanInput[],
  categories: ReadonlyMap<string, BudgetCategory>,
  currency: string,
  /** FR 24: today's rates of the other currencies the request names (`inputRates`). */
  rates: PlanRates = new Map(),
): { rows: { categoryId: string; amount: Money | null }[]; issues: BudgetIssue[] } {
  const issues: BudgetIssue[] = [];
  const rows: { categoryId: string; amount: Money | null }[] = [];
  const seen = new Set<string>();
  inputs.forEach((l, i) => {
    const field = `incomePlans.${i}`;
    const duplicate = seen.has(l.categoryId);
    const problem = duplicate ? "duplicate" : incomePlanIssue(categories.get(l.categoryId));
    seen.add(l.categoryId);
    // A category twice is refused also when one of them removes it: the audit's «before» stays true.
    if (problem && (duplicate || l.amount !== null))
      return issues.push({ field: `${field}.categoryId`, issue: problem });
    if (l.amount === null) return rows.push({ categoryId: l.categoryId, amount: null });
    const amount = parseCategoryAmount(`${field}.amount`, l.amount, currency, rates);
    if (amount instanceof Money) rows.push({ categoryId: l.categoryId, amount });
    else issues.push(amount);
  });
  return { rows, issues };
}

/**
 * FR 3, FR 21: the income plan a new plan gives — by income category (`incomePlans`; the plan = their sum) or, without
 * categories, one amount (`incomePlan`; 0 by default). Not both: 400 `incomePlan: with_income_plans`.
 */
export function checkIncome(
  input: {
    readonly incomePlan?: { readonly amount: string; readonly currency: string } | undefined;
    readonly incomePlans?: readonly IncomePlanInput[] | undefined;
  },
  categories: ReadonlyMap<string, BudgetCategory>,
  currency: string,
  rates: PlanRates = new Map(),
): {
  total: Money | null;
  rows: { categoryId: string; amount: Money }[];
  issues: BudgetIssue[];
} {
  if (input.incomePlans !== undefined) {
    const checked = checkIncomePlans(input.incomePlans, categories, currency, rates);
    const issues = [...checked.issues];
    if (input.incomePlan !== undefined) issues.push({ field: "incomePlan", issue: "with_income_plans" });
    // A new plan has nothing to remove: «Прибрати» is leaving the row out.
    checked.rows.forEach((r, i) => {
      if (r.amount === null) issues.push({ field: `incomePlans.${i}.amount`, issue: "invalid" });
    });
    const rows = checked.rows.flatMap((r) => (r.amount === null ? [] : [{ ...r, amount: r.amount }]));
    return { total: issues.length > 0 ? null : convertedTotal(rows, currency, rates), rows, issues };
  }
  const income = input.incomePlan
    ? parseBudgetAmount("incomePlan", input.incomePlan, currency)
    : Money.zero(currency);
  return income instanceof Money
    ? { total: income, rows: [], issues: [] }
    : { total: null, rows: [], issues: [income] };
}

const incomePlanChange = (categoryId: string, before: Money | null, after: Money | null, currency?: string) =>
  limitChange(categoryId, before, after, currency);

export interface LimitInput {
  readonly categoryId: string;
  /** Null — «прибрати ліміт» (FR 7). */
  readonly amount: { readonly amount: string; readonly currency: string } | null;
}

/** FR 7: each limit of an active expense category of the space, once, ≥ 0 in the budget's currency. */
export function checkLimits(
  inputs: readonly LimitInput[],
  categories: ReadonlyMap<string, BudgetCategory>,
  currency: string,
  /** FR 24: today's rates of the other currencies the request names (`inputRates`). */
  rates: PlanRates = new Map(),
): { limits: { categoryId: string; amount: Money | null }[]; issues: BudgetIssue[] } {
  const issues: BudgetIssue[] = [];
  const limits: { categoryId: string; amount: Money | null }[] = [];
  const seen = new Set<string>();
  inputs.forEach((l, i) => {
    const field = `limits.${i}`;
    const duplicate = seen.has(l.categoryId);
    const problem = duplicate ? "duplicate" : limitIssue(categories.get(l.categoryId));
    seen.add(l.categoryId);
    // A category twice is refused also when one of them removes the limit: the audit's «before» stays true.
    if (problem && (duplicate || l.amount !== null))
      return issues.push({ field: `${field}.categoryId`, issue: problem });
    if (l.amount === null) return limits.push({ categoryId: l.categoryId, amount: null });
    const amount = parseCategoryAmount(`${field}.amount`, l.amount, currency, rates);
    if (amount instanceof Money) limits.push({ categoryId: l.categoryId, amount });
    else issues.push(amount);
  });
  return { limits, issues };
}

/**
 * FR 24: the lines' sum in the budget's currency at `rates` (a line without a rate counts 0, as in the plan). The
 * budget's stored `income_plan` is this sum at today's rate when the plan is saved; a read converts again.
 */
export function convertedTotal(
  lines: readonly { readonly categoryId: string; readonly amount: Money }[],
  currency: string,
  rates: PlanRates,
): Money {
  return incomePlansTotal(
    lines.map((l) => ({
      categoryId: l.categoryId,
      amount: inBudgetCurrency(l.amount, currency, rates) ?? Money.zero(currency),
    })),
    currency,
  );
}

/** FR 24: the rates of the currencies other than the budget's on `date`; none needed — no call. */
export async function ratesOn(
  deps: Pick<BudgetDeps, "rates">,
  currencies: Iterable<string>,
  currency: string,
  date: string,
): Promise<PlanRates> {
  // A code the registry does not know has no rate: never asked for (a request names it before it is checked — 400).
  const other = [...new Set(currencies)].filter((c) => c !== currency && isCurrencyCode(c)).sort();
  if (other.length === 0 || !deps.rates) return new Map();
  return deps.rates.rates(other, currency, date);
}

/** FR 24: today's rates of the other currencies a request's limits and income plans name (before they are checked). */
export function inputRates(
  deps: Pick<BudgetDeps, "rates" | "today">,
  currency: string,
  input: {
    readonly incomePlans?: readonly IncomePlanInput[] | undefined;
    readonly limits?: readonly LimitInput[] | undefined;
  },
): Promise<PlanRates> {
  const named = [...(input.limits ?? []), ...(input.incomePlans ?? [])].flatMap((l) =>
    l.amount === null ? [] : [l.amount.currency],
  );
  return ratesOn(deps, named, currency, deps.today());
}

/** FR 24: the rates a plan of these stored lines needs on `date` (today, or a finished period's last day). */
export const linesRates = (
  deps: Pick<BudgetDeps, "rates">,
  budget: StoredBudget,
  lines: readonly StoredLimit[],
  date: string,
): Promise<PlanRates> => planRatesOn(deps, budget, lines, [], date);

/** FR 24, BUD-17: the rates of the lines' and the cells' currencies on `date`. */
export const planRatesOn = (
  deps: Pick<BudgetDeps, "rates">,
  budget: StoredBudget,
  lines: readonly StoredLimit[],
  cells: readonly PlanCell[],
  date: string,
): Promise<PlanRates> =>
  ratesOn(
    deps,
    [...lines.map((l) => l.amount.currency), ...cells.flatMap((c) => (c.amount ? [c.amount.currency] : []))],
    budget.currency,
    date,
  );

/**
 * FR 11: before any change of the budget, and on the first view of a finished period, every finished period without a
 * snapshot keeps the plan it had — the plan as it is now, since a change acts only from the current period on. Called
 * under the budget's row lock. «Обов'язкова» is the categories' attribute (BUD-01 FR 11) as it is at that moment.
 */
export async function ensureSnapshots(
  deps: Pick<BudgetDeps, "planEnabled" | "rates">,
  tx: BudgetTx,
  householdId: string,
  budget: StoredBudget,
  today: string,
  categories: ReadonlyMap<string, BudgetCategory>,
  lines: LinesOf,
): Promise<void> {
  const missing = periodsToSnapshot(
    budget.firstPeriod,
    today,
    new Set((await tx.snapshots(householdId, budget.id)).keys()),
  );
  if (missing.length === 0) return;
  const limits = await tx.limits(householdId, budget.id);
  const incomePlans = await tx.incomePlans(householdId, budget.id);
  const cells = await planCellsInEffect(deps, tx, householdId, budget.id);
  // FR 24: a finished period converts at the rate of its last day, and its snapshot keeps that rate.
  for (const p of missing) {
    const own = cells.filter((c) => c.period === p);
    const rates = await planRatesOn(deps, budget, [...limits, ...incomePlans], own, periodDays(p).to);
    const plan = livePlan(budget, limits, categories, incomePlans, rates);
    await tx.insertSnapshot(
      householdId,
      budget.id,
      p,
      monthPlan(budget, p, plan, cells, categories, await lines(p), rates),
    );
  }
}

/**
 * BUD-17 business rules (owner decision 2026-11-20, batch 2, item 2): the months' own values of «План» that act on the
 * plan — on «Бюджет» (limits, income plan, planned savings), in «Можна витратити», «Тренд», «Порівняння» and a snapshot
 * written now. While `budget.plan` is off for the space — none: the cells stay stored and act again once it is on.
 */
export async function planCellsInEffect(
  deps: Pick<BudgetDeps, "planEnabled">,
  tx: Pick<BudgetTx, "planCells">,
  householdId: string,
  budgetId: string,
  from?: Period,
): Promise<PlanCell[]> {
  if (!(await deps.planEnabled(householdId))) return [];
  return tx.planCells(householdId, budgetId, from);
}

/** The lines of a month (domain/plan-grid.ts `PlanLines`), read from modules recurring and goals when asked. */
export type LinesOf = (period: Period) => Promise<PlanLines>;

/**
 * FR 1, edge case 2: the lines a month's cells count on besides the categories — the active goals (read once). Without
 * the ports (a test's server) there are none: no goal cell counts.
 */
export function planLines(
  deps: Pick<BudgetDeps, "planSources">,
  householdId: string,
  currency: string,
): LinesOf {
  let goalIds: Promise<ReadonlySet<string>> | null = null;
  return async () => {
    const sources = deps.planSources;
    if (!sources) return { goalIds: new Set() };
    goalIds ??= sources.goals(householdId, currency).then((gs) => new Set(gs.map((g) => g.goalId)));
    return { goalIds: await goalIds };
  };
}

/**
 * BUD-17 FR 2: the plan of a month — the budget-wide plan (a proportional first period scaled) with the month's own
 * cells (domain/plan-grid.ts).
 */
export function monthPlan(
  budget: StoredBudget,
  period: Period,
  live: PeriodPlan,
  cells: readonly PlanCell[],
  categories: ReadonlyMap<string, BudgetCategory>,
  lines: PlanLines | null,
  /** FR 24: the rates of the lines' and the cells' currencies (a cell of another currency converted at them). */
  rates?: PlanRates,
): PeriodPlan {
  return withCells(
    planOf(budget, period, live),
    cells.filter((c) => c.period === period),
    categories,
    lines,
    rates,
  );
}

/** FR 14: a proportional first period has the plan × its share of days; every other period the plan as it is. */
export function planOf(budget: StoredBudget, period: Period, plan: PeriodPlan): PeriodPlan {
  return budget.firstDay !== null && period === budget.firstPeriod
    ? scalePlan(plan, shareFrom(budget.firstDay))
    : plan;
}

/** FR 14: the first day the period counts — the proportional first period's start, else its 1st (undefined). */
export const countsFrom = (budget: StoredBudget, period: Period): string | undefined =>
  budget.firstDay !== null && period === budget.firstPeriod ? budget.firstDay : undefined;

export function livePlan(
  budget: StoredBudget,
  limits: readonly StoredLimit[],
  categories: ReadonlyMap<string, BudgetCategory>,
  /** FR 21: the income plan by category; the income plan is their sum. */
  incomePlans: readonly StoredLimit[] = [],
  /** FR 24: the rates of the lines' other currencies (`linesRates`); a currency without one counts 0. */
  rates: PlanRates = new Map(),
): PeriodPlan {
  const currency = budget.currency;
  const income = convertLines(incomePlans, currency, rates);
  return withPlanRates(
    {
      // FR 21, FR 24: the sum of the categories' plans at the plan's rates; without categories — the stored plan.
      incomePlan: income.length > 0 ? incomePlansTotal(income, currency) : budget.incomePlan,
      incomePlans: income,
      plannedSavings: Money.zero(currency),
      limits: convertLines(limits, currency, rates).map((l) => ({
        ...l,
        mandatory: categories.get(l.categoryId)?.essential ?? false,
      })),
    },
    rates,
  );
}

/**
 * FR 24: the plan as it is now at today's rates (the current and future periods, GET /v1/budget) and those rates — of
 * the lines' currencies and of the cells' (BUD-17: a month's own value in a category's currency).
 */
export async function livePlanToday(
  deps: Pick<BudgetDeps, "rates" | "today">,
  budget: StoredBudget,
  limits: readonly StoredLimit[],
  categories: ReadonlyMap<string, BudgetCategory>,
  incomePlans: readonly StoredLimit[] = [],
  cells: readonly PlanCell[] = [],
): Promise<PeriodPlan & { readonly allRates: PlanRates }> {
  const rates = await planRatesOn(deps, budget, [...limits, ...incomePlans], cells, deps.today());
  return { ...livePlan(budget, limits, categories, incomePlans, rates), allRates: rates };
}

export const byId = (categories: readonly BudgetCategory[]): ReadonlyMap<string, BudgetCategory> =>
  new Map(categories.map((c) => [c.id, c]));

/**
 * «Почати з нуля» and the saving of the wizard (FR 1, FR 2, FR 5, FR 14; edge case 6): one budget per space, in the
 * space's reporting currency, starting with the current or the next month — or, from the 2nd of the month on,
 * proportionally from today (`proportional`). There is no default start: `firstPeriod` is required.
 */
export async function createBudget(
  deps: BudgetDeps,
  tx: BudgetTx,
  caller: Caller,
  input: {
    readonly firstPeriod: string;
    /** FR 14: «Пропорційно на <сьогодні>–<останній день>» — the current month from today, not on its 1st. */
    readonly proportional?: boolean | undefined;
    readonly incomePlan?: { readonly amount: string; readonly currency: string } | undefined;
    /** FR 21: «План доходу» by income category; the income plan is their sum. Not with `incomePlan`. */
    readonly incomePlans?: readonly IncomePlanInput[] | undefined;
    readonly limits?: readonly LimitInput[] | undefined;
  },
  categories: ReadonlyMap<string, BudgetCategory>,
  /** FR 15: the cells «Розподіл» plans for the first period, checked against its balance (`planAllocation`). */
  allocation: readonly AllocationCell[] = [],
): Promise<Handed<Result<StoredBudget>>> {
  const currency = deps.reportingCurrency;
  const issues: BudgetIssue[] = [];
  if (!isPeriod(input.firstPeriod) || !firstPeriodChoices(deps.today()).includes(input.firstPeriod))
    issues.push({ field: "firstPeriod", issue: "invalid" });
  const today = deps.today();
  const proportional = startChoices(today).choices.find((c) => c.start === "proportional");
  if (input.proportional === true && proportional?.firstPeriod !== input.firstPeriod)
    issues.push({ field: "proportional", issue: "invalid" });
  const rates = await inputRates(deps, currency, input);
  const incomeChecked = checkIncome(input, categories, currency, rates);
  issues.push(...incomeChecked.issues);
  const income = incomeChecked.total;
  const checked = checkLimits(input.limits ?? [], categories, currency, rates);
  issues.push(...checked.issues);
  if (issues.length > 0 || income === null) return { result: { kind: "invalid", issues }, handOffs: [] };
  const budget: StoredBudget = {
    id: deps.newId(),
    currency,
    firstPeriod: input.firstPeriod,
    incomePlan: income,
    createdOn: today,
    version: 1,
    firstDay: input.proportional === true ? today : null,
  };
  if (!(await tx.insertBudget(caller.householdId, budget)))
    return { result: { kind: "exists" }, handOffs: [] };
  const fields = budgetFields(budget);
  const handOffs = [
    handOff(
      deps,
      caller,
      "budget.budget",
      budget.id,
      "create",
      Object.entries(fields).map(([field, after]) => ({ field, before: null, after })),
    ),
  ];
  for (const l of checked.limits)
    if (l.amount !== null) {
      await tx.setLimit(caller.householdId, budget.id, l.categoryId, l.amount);
      handOffs.push(
        handOff(
          deps,
          caller,
          "budget.limit",
          l.categoryId,
          "create",
          limitChange(l.categoryId, null, l.amount, budget.currency),
        ),
      );
    }
  // FR 21: «План доходу» by income category, in this transaction with the budget (its income plan is their sum).
  for (const r of incomeChecked.rows) {
    await tx.setIncomePlan(caller.householdId, budget.id, r.categoryId, r.amount);
    handOffs.push(
      handOff(
        deps,
        caller,
        "budget.income-plan",
        r.categoryId,
        "create",
        incomePlanChange(r.categoryId, null, r.amount, budget.currency),
      ),
    );
  }
  // FR 15: «Розподіл» writes only the plan — the first period's cells of «План», in this transaction with the budget.
  for (const c of allocation) {
    const cell = { period: budget.firstPeriod, kind: c.kind, lineId: c.lineId };
    await tx.setPlanCell(caller.householdId, budget.id, { ...cell, amount: c.amount }, currency);
    handOffs.push(cellHandOff(deps, caller, budget, cell, null, c.amount));
  }
  for (const h of handOffs) await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: budget }, handOffs };
}

/**
 * FR 7, FR 8, FR 21, AC4, AC16: set, change or remove limits and the income plan of income categories (or the plan
 * without categories), from the current period on; finished periods keep their snapshots; nothing carries over between
 * months. With `incomePlans` the income plan becomes the sum of the categories' plans; a plan by category takes no
 * `incomePlan` (400 `incomePlan: by_category`). `version` — the budget as the page read it.
 */
export async function updatePlan(
  deps: BudgetDeps,
  tx: BudgetTx,
  caller: Caller,
  version: number,
  patch: {
    readonly incomePlan?: { readonly amount: string; readonly currency: string } | undefined;
    readonly incomePlans?: readonly IncomePlanInput[] | undefined;
    readonly limits?: readonly LimitInput[] | undefined;
  },
  categories: ReadonlyMap<string, BudgetCategory>,
): Promise<Handed<Result<StoredBudget>>> {
  const budget = await tx.budget(caller.householdId, true);
  if (!budget) return { result: { kind: "not-found" }, handOffs: [] };
  if (budget.version !== version)
    return { result: { kind: "conflict", version: budget.version }, handOffs: [] };
  const issues: BudgetIssue[] = [];
  const storedIncome = new Map(
    (await tx.incomePlans(caller.householdId, budget.id)).map((l) => [l.categoryId, l.amount]),
  );
  let income: Money | BudgetIssue = patch.incomePlan
    ? parseBudgetAmount("incomePlan", patch.incomePlan, budget.currency)
    : budget.incomePlan;
  if (!(income instanceof Money)) issues.push(income);
  else if (patch.incomePlan && patch.incomePlans !== undefined)
    issues.push({ field: "incomePlan", issue: "with_income_plans" });
  // FR 21: a plan by category is the sum of its categories — it is changed through them.
  else if (patch.incomePlan && storedIncome.size > 0)
    issues.push({ field: "incomePlan", issue: "by_category" });
  const rates = await inputRates(deps, budget.currency, patch);
  const incomeRows = checkIncomePlans(patch.incomePlans ?? [], categories, budget.currency, rates);
  issues.push(...incomeRows.issues);
  const checked = checkLimits(patch.limits ?? [], categories, budget.currency, rates);
  issues.push(...checked.issues);
  if (issues.length > 0 || !(income instanceof Money))
    return { result: { kind: "invalid", issues }, handOffs: [] };
  await ensureSnapshots(
    deps,
    tx,
    caller.householdId,
    budget,
    deps.today(),
    categories,
    planLines(deps, caller.householdId, budget.currency),
  );
  const stored = new Map(
    (await tx.limits(caller.householdId, budget.id)).map((l) => [l.categoryId, l.amount]),
  );
  const handOffs: BudgetHandOff[] = [];
  for (const l of checked.limits) {
    const before = stored.get(l.categoryId) ?? null;
    if (before === null ? l.amount === null : l.amount !== null && before.equals(l.amount)) continue;
    await tx.setLimit(caller.householdId, budget.id, l.categoryId, l.amount);
    const action = before === null ? "create" : l.amount === null ? "delete" : "update";
    handOffs.push(
      handOff(
        deps,
        caller,
        "budget.limit",
        l.categoryId,
        action,
        limitChange(l.categoryId, before, l.amount, budget.currency),
      ),
    );
  }
  let incomeChanged = false;
  for (const r of incomeRows.rows) {
    const before = storedIncome.get(r.categoryId) ?? null;
    if (before === null ? r.amount === null : r.amount !== null && before.equals(r.amount)) continue;
    await tx.setIncomePlan(caller.householdId, budget.id, r.categoryId, r.amount);
    incomeChanged = true;
    if (r.amount === null) storedIncome.delete(r.categoryId);
    else storedIncome.set(r.categoryId, r.amount);
    handOffs.push(
      handOff(
        deps,
        caller,
        "budget.income-plan",
        r.categoryId,
        before === null ? "create" : r.amount === null ? "delete" : "update",
        incomePlanChange(r.categoryId, before, r.amount, budget.currency),
      ),
    );
  }
  // FR 21: the income plan is the sum of the income categories' plans. A change that touches no category of a plan
  // without categories (an empty list, «Прибрати» for a category that has no plan) leaves that plan as it is.
  // FR 24: only when a category's plan changed — today's rate alone changes nothing that is stored.
  if (patch.incomePlans !== undefined && incomeChanged) {
    const lines = [...storedIncome].map(([categoryId, amount]) => ({ categoryId, amount }));
    // FR 24: the stored income plan is the sum at today's rates (a read converts again at its own).
    income = convertedTotal(lines, budget.currency, await linesRates(deps, budget, lines, deps.today()));
  }
  if (!income.equals(budget.incomePlan))
    handOffs.push(
      handOff(deps, caller, "budget.budget", budget.id, "update", [
        {
          field: "incomePlan",
          before: budget.incomePlan.toDecimalString(),
          after: income.toDecimalString(),
        },
      ]),
    );
  if (handOffs.length === 0) return { result: { kind: "ok", value: budget }, handOffs };
  // BUD-17 business rules (owner decision 2026-11-19, Q2): a change of the limit or the income plan acts on the current
  // and future periods; the months' own values typed on «План» are kept and still win in their month.
  const updated = await tx.updateBudget(caller.householdId, budget.id, income);
  for (const h of handOffs) await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: updated }, handOffs };
}

/** BUD-17: the audit entry of a cell — its month, line and amount before and after. */
export function cellHandOff(
  deps: Pick<BudgetDeps, "newId">,
  caller: Caller,
  budget: StoredBudget,
  cell: Pick<PlanCell, "period" | "kind" | "lineId">,
  before: Money | null,
  after: Money | null,
): BudgetHandOff {
  return handOff(
    deps,
    caller,
    "budget.plan-cell",
    cell.lineId ?? budget.id,
    before === null ? "create" : after === null ? "delete" : "update",
    [
      { field: "period", before: cell.period, after: cell.period },
      { field: "kind", before: cell.kind, after: cell.kind },
      { field: "amount", before: before?.toDecimalString() ?? null, after: after?.toDecimalString() ?? null },
      // BUD-02 FR 24 (#709): the same digits in another currency are a change too.
      { field: "currency", before: before?.currency ?? null, after: after?.currency ?? null },
    ],
  );
}

/** FR 10, AC2: whether the account is in the budget; a switched-off account still counts in net worth and the list. */
export const isIncluded = (account: BudgetAccount, choices: ReadonlyMap<string, boolean>): boolean =>
  choices.get(account.accountId) ?? includedByDefault(account.kind);

/** FR 10, AC2, AC14: «Рахунки бюджету» — switch an account of the space in or out of the budget. */
export async function setBudgetAccount(
  deps: BudgetDeps,
  tx: BudgetTx,
  caller: Caller,
  account: BudgetAccount,
  included: boolean,
  categories: ReadonlyMap<string, BudgetCategory>,
): Promise<Handed<Result<StoredBudget>>> {
  const budget = await tx.budget(caller.householdId, true);
  if (!budget) return { result: { kind: "not-found" }, handOffs: [] };
  const before = isIncluded(account, await tx.accountChoices(caller.householdId));
  if (before === included) return { result: { kind: "ok", value: budget }, handOffs: [] };
  await ensureSnapshots(
    deps,
    tx,
    caller.householdId,
    budget,
    deps.today(),
    categories,
    planLines(deps, caller.householdId, budget.currency),
  );
  await tx.setAccountChoice(
    caller.householdId,
    budget.id,
    account.accountId,
    included === includedByDefault(account.kind) ? null : included,
  );
  const updated = await tx.updateBudget(caller.householdId, budget.id, budget.incomePlan);
  const h = handOff(deps, caller, "budget.account", account.accountId, "update", [
    { field: "included", before: String(before), after: String(included) },
  ]);
  await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: updated }, handOffs: [h] };
}

/** FR 13: the Owner deletes the budget with its limits and snapshots (the page asks to confirm). */
export async function deleteBudget(
  deps: BudgetDeps,
  tx: BudgetTx,
  caller: Caller,
): Promise<Handed<Result<null>>> {
  const budget = await tx.budget(caller.householdId, true);
  if (!budget) return { result: { kind: "not-found" }, handOffs: [] };
  const limits = await tx.limits(caller.householdId, budget.id);
  const incomePlans = await tx.incomePlans(caller.householdId, budget.id);
  await tx.deleteBudget(caller.householdId, budget.id);
  const handOffs = [
    handOff(
      deps,
      caller,
      "budget.budget",
      budget.id,
      "delete",
      Object.entries(budgetFields(budget)).map(([field, before]) => ({ field, before, after: null })),
    ),
    ...limits.map((l) =>
      handOff(
        deps,
        caller,
        "budget.limit",
        l.categoryId,
        "delete",
        limitChange(l.categoryId, l.amount, null, budget.currency),
      ),
    ),
    ...incomePlans.map((l) =>
      handOff(
        deps,
        caller,
        "budget.income-plan",
        l.categoryId,
        "delete",
        incomePlanChange(l.categoryId, l.amount, null, budget.currency),
      ),
    ),
  ];
  for (const h of handOffs) await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: null }, handOffs };
}

/** BUD-01@PoC FR 12 (owner decision 2026-11-26): a category's entries in the budget, which a delete removes with it. */
export interface CategoryEntries {
  /** The limit (an income category: its plan) of the current period; null — none then. */
  readonly limit: Money | null;
  /** The budget keeps a limit or an income plan of the category. */
  readonly stored: boolean;
  /** Months of «План» with the category's own value. */
  readonly planCells: number;
}

const NO_ENTRIES: CategoryEntries = { limit: null, stored: false, planCells: 0 };

/** BUD-02 FR 24 (#709): a plan line's amount in its own currency. */
const planAmount = (
  l: { readonly amount: Money; readonly original?: Money } | undefined,
): Money | undefined => (l === undefined ? undefined : (l.original ?? l.amount));

/**
 * BUD-01@PoC FR 12, AC22: the category's entries — the confirmation «ліміт N теж буде видалено» names the current
 * period's limit (lead decision 2026-11-26: N is the current period's), with the month's own value of «План» if any.
 */
export async function categoryEntries(
  deps: Pick<BudgetDeps, "today" | "planSources" | "planEnabled" | "rates">,
  tx: BudgetTx,
  householdId: string,
  categoryId: string,
  categories: ReadonlyMap<string, BudgetCategory>,
  budget?: StoredBudget,
): Promise<CategoryEntries> {
  const b = budget ?? (await tx.budget(householdId));
  if (!b) return NO_ENTRIES;
  const limit = (await tx.limits(householdId, b.id)).find((l) => l.categoryId === categoryId);
  const income = (await tx.incomePlans(householdId, b.id)).find((l) => l.categoryId === categoryId);
  // Row 231: an income category's months of «Надходження» are its cells too (kind `income`).
  const planCells = (await tx.planCells(householdId, b.id)).filter(
    (c) => (c.kind === "limit" || c.kind === "income") && c.lineId === categoryId && c.amount !== null,
  ).length;
  const period = periodOf(deps.today());
  const plan = period < b.firstPeriod ? null : await periodPlan(deps, tx, householdId, b, period, categories);
  const current =
    plan === null
      ? (limit?.amount ?? income?.amount ?? null)
      : // BUD-02 FR 24 (#709): the limit in the category's own currency, as it was typed.
        (planAmount(plan.limits.find((l) => l.categoryId === categoryId)) ??
        planAmount(plan.incomePlans?.find((l) => l.categoryId === categoryId)) ??
        null);
  return { limit: current, stored: limit !== undefined || income !== undefined, planCells };
}

/**
 * BUD-01@PoC FR 12, AC22; BUD-02@PoC FR 23 (owner decision 2026-11-26): a category deleted with its budget entries —
 * its limit (an income category: its plan; the income plan becomes the sum of the others) and every «План» cell of
 * its line go, each with its audit entry, under the budget's row lock. Finished periods get their snapshots first, as
 * on every change, so they keep the category as it was (lead decision 2026-11-26: snapshots are history). Returns
 * what it removed (the limit — the current period's). Module categories calls it under its own row lock.
 */
export async function releaseCategory(
  deps: BudgetDeps,
  tx: BudgetTx,
  caller: Caller,
  categoryId: string,
  categories: ReadonlyMap<string, BudgetCategory>,
): Promise<Handed<CategoryEntries>> {
  const budget = await tx.budget(caller.householdId, true);
  if (!budget) return { result: NO_ENTRIES, handOffs: [] };
  await ensureSnapshots(
    deps,
    tx,
    caller.householdId,
    budget,
    deps.today(),
    categories,
    planLines(deps, caller.householdId, budget.currency),
  );
  const entries = await categoryEntries(deps, tx, caller.householdId, categoryId, categories, budget);
  const handOffs: BudgetHandOff[] = [];
  const limit = (await tx.limits(caller.householdId, budget.id)).find((l) => l.categoryId === categoryId);
  if (limit) {
    await tx.setLimit(caller.householdId, budget.id, categoryId, null);
    handOffs.push(
      handOff(
        deps,
        caller,
        "budget.limit",
        categoryId,
        "delete",
        limitChange(categoryId, limit.amount, null, budget.currency),
      ),
    );
  }
  let income = budget.incomePlan;
  const plans = await tx.incomePlans(caller.householdId, budget.id);
  const plan = plans.find((l) => l.categoryId === categoryId);
  if (plan) {
    await tx.setIncomePlan(caller.householdId, budget.id, categoryId, null);
    handOffs.push(
      handOff(
        deps,
        caller,
        "budget.income-plan",
        categoryId,
        "delete",
        incomePlanChange(categoryId, plan.amount, null, budget.currency),
      ),
    );
    // FR 21: the income plan by category is the sum of the categories' plans; BUD-02 FR 24 (#709): at today's rates,
    // as `updatePlan` stores it.
    const rest = plans.filter((l) => l.categoryId !== categoryId);
    income = convertedTotal(rest, budget.currency, await linesRates(deps, budget, rest, deps.today()));
    if (!income.equals(budget.incomePlan))
      handOffs.push(
        handOff(deps, caller, "budget.budget", budget.id, "update", [
          {
            field: "incomePlan",
            before: budget.incomePlan.toDecimalString(),
            after: income.toDecimalString(),
          },
        ]),
      );
  }
  const cells = [
    ...(await tx.deletePlanCells(caller.householdId, budget.id, "limit", categoryId)),
    // Row 231: the category's months of «Надходження» (owner decision 2026-11-21, 2 б).
    ...(await tx.deletePlanCells(caller.householdId, budget.id, "income", categoryId)),
  ];
  for (const c of cells)
    if (c.amount !== null) handOffs.push(cellHandOff(deps, caller, budget, c, c.amount, null));
  if (!limit && !plan && cells.length === 0) return { result: NO_ENTRIES, handOffs: [] };
  // A page open in another window sees the new version (VERSION_CONFLICT) instead of writing the category back.
  await tx.updateBudget(caller.householdId, budget.id, income);
  for (const h of handOffs) await tx.enqueueHandOff(h);
  return { result: entries, handOffs };
}

/**
 * The plan a period shows (FR 11, FR 16): a finished one — its snapshot (written now if this is its first view); the
 * current and future ones — the plan as it is. Null — a period before the first one (edge case 5).
 */
export async function periodPlan(
  deps: Pick<BudgetDeps, "today" | "planSources" | "planEnabled" | "rates">,
  tx: BudgetTx,
  householdId: string,
  budget: StoredBudget,
  period: Period,
  categories: ReadonlyMap<string, BudgetCategory>,
): Promise<PeriodPlan | null> {
  if (period < budget.firstPeriod) return null;
  const today = deps.today();
  if (periodMode(period, today) !== "past") {
    const cells = await planCellsInEffect(deps, tx, householdId, budget.id, period);
    const live = await livePlanToday(
      deps,
      budget,
      await tx.limits(householdId, budget.id),
      categories,
      await tx.incomePlans(householdId, budget.id),
      cells.filter((c) => c.period === period),
    );
    return monthPlan(
      budget,
      period,
      live,
      cells,
      categories,
      await planLines(deps, householdId, budget.currency)(period),
      live.allRates,
    );
  }
  let snapshot = (await tx.snapshots(householdId, budget.id)).get(period);
  if (!snapshot) {
    const locked = await tx.budget(householdId, true);
    if (!locked) return null;
    await ensureSnapshots(
      deps,
      tx,
      householdId,
      locked,
      today,
      categories,
      planLines(deps, householdId, budget.currency),
    );
    snapshot = (await tx.snapshots(householdId, budget.id)).get(period);
  }
  if (!snapshot) return null;
  return (await lateRates(deps, tx, householdId, budget, new Map([[period, snapshot]]))).get(period) ?? null;
}

/**
 * FR 11, FR 24 (lead decision 2026-11-26, #709): the snapshots of finished periods whose line had no rate on the last
 * day — converted at the first rate of that currency that appears after, written into the snapshot under the budget's
 * row lock (once: later reads find it there). The rate asked is the one of today (the latest known).
 */
export async function lateRates(
  deps: Pick<BudgetDeps, "today" | "rates">,
  tx: BudgetTx,
  householdId: string,
  budget: StoredBudget,
  snapshots: ReadonlyMap<Period, PeriodPlan>,
): Promise<ReadonlyMap<Period, PeriodPlan>> {
  const waiting = [...snapshots].filter(([, plan]) => (plan.missingRates ?? []).length > 0);
  if (waiting.length === 0) return snapshots;
  const currencies = new Set(waiting.flatMap(([, plan]) => plan.missingRates ?? []));
  const rates = await ratesOn(deps, currencies, budget.currency, deps.today());
  if (rates.size === 0) return snapshots;
  if (!(await tx.budget(householdId, true))) return snapshots;
  // Under the lock: another request may have written the rate in between — read the snapshots again.
  const fresh = await tx.snapshots(householdId, budget.id);
  const out = new Map(snapshots);
  for (const [period] of waiting) {
    const current = fresh.get(period);
    if (!current) continue;
    const resolved = withLateRates(current, rates);
    if (resolved !== current) await tx.updateSnapshotRates(householdId, budget.id, period, resolved);
    out.set(period, resolved);
  }
  return out;
}

/**
 * BUD-16@PoC FR 4: the plans of many months in one budget transaction — as `periodPlan` for each, with one snapshot
 * pass (under the budget's row lock) when a finished month has none yet. Null — a month before the first one.
 */
export async function periodPlans(
  deps: Pick<BudgetDeps, "today" | "planSources" | "planEnabled" | "rates">,
  tx: BudgetTx,
  householdId: string,
  budget: StoredBudget,
  periods: readonly Period[],
  categories: ReadonlyMap<string, BudgetCategory>,
  /** The trend reads the limits only: a current or future month's income and savings are not resolved then. */
  limitsOnly = false,
): Promise<ReadonlyMap<Period, PeriodPlan | null>> {
  const today = deps.today();
  const lines = planLines(deps, householdId, budget.currency);
  let snapshots = await tx.snapshots(householdId, budget.id);
  const finished = periods.filter((p) => p >= budget.firstPeriod && periodMode(p, today) === "past");
  if (finished.some((p) => !snapshots.has(p))) {
    const locked = await tx.budget(householdId, true);
    if (locked) await ensureSnapshots(deps, tx, householdId, locked, today, categories, lines);
    snapshots = await tx.snapshots(householdId, budget.id);
  }
  // FR 24 (#709): a finished month whose currency had no rate takes the first one that appeared after.
  snapshots = await lateRates(
    deps,
    tx,
    householdId,
    budget,
    new Map([...snapshots].filter(([p]) => periods.includes(p))),
  );
  const cells = await planCellsInEffect(deps, tx, householdId, budget.id, periodOf(today));
  const live = await livePlanToday(
    deps,
    budget,
    await tx.limits(householdId, budget.id),
    categories,
    limitsOnly ? [] : await tx.incomePlans(householdId, budget.id),
    cells,
  );
  const out = new Map<Period, PeriodPlan | null>();
  for (const p of periods)
    out.set(
      p,
      p < budget.firstPeriod
        ? null
        : periodMode(p, today) === "past"
          ? (snapshots.get(p) ?? null)
          : monthPlan(budget, p, live, cells, categories, limitsOnly ? null : await lines(p), live.allRates),
    );
  return out;
}
