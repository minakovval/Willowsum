import { Money } from "@willowsum/domain-kernel";
import {
  firstPeriodChoices,
  includedByDefault,
  isPeriod,
  limitIssue,
  parseBudgetAmount,
  periodMode,
  periodsToSnapshot,
  scalePlan,
  shareFrom,
  startChoices,
  type BudgetCategory,
  type BudgetIssue,
  type CountedAmount,
  type Period,
  type PeriodObligations,
  type PeriodPlan,
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
  ): Promise<{
    readonly amounts: readonly CountedAmount[];
    readonly nearestRateCount: number;
    readonly unavailableCount: number;
  }>;
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

export interface BudgetDeps {
  readonly newId: () => string;
  /** «Сьогодні» — the Kyiv date. */
  readonly today: () => string;
  /** The space's reporting currency (ACC-06): the budget's, fixed when it is created (FR 1). */
  readonly reportingCurrency: string;
  readonly reads: BudgetReads;
  /** Null — not wired (a test's server only; the API process wires it). */
  readonly obligations: BudgetObligations | null;
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
export const BUDGET_AUDIT_ENTITIES = ["budget.budget", "budget.limit", "budget.account"] as const;

/**
 * The hand-off of a budget change to the audit log («Кожна зміна пишеться в журнал аудиту зі значеннями до і після»;
 * ARC-04 FR 2, FR 3; ADR-0015): the row and this job in one budget transaction, the entry after the commit — right away
 * and by the worker if that failed — once per key. It carries the values: ids, periods, amounts as decimal strings.
 */
export interface BudgetHandOff {
  readonly entity: (typeof BUDGET_AUDIT_ENTITIES)[number];
  /** The budget, the limit's category or the account. */
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

const limitChange = (categoryId: string, before: Money | null, after: Money | null) => [
  { field: "categoryId", before: before ? categoryId : null, after: after ? categoryId : null },
  { field: "amount", before: before?.toDecimalString() ?? null, after: after?.toDecimalString() ?? null },
];

/** The most limits one request sets. */
export const LIMITS_MAX = 300;

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
    const amount = parseBudgetAmount(`${field}.amount`, l.amount, currency);
    if (amount instanceof Money) limits.push({ categoryId: l.categoryId, amount });
    else issues.push(amount);
  });
  return { limits, issues };
}

/**
 * FR 11: before any change of the budget, and on the first view of a finished period, every finished period without a
 * snapshot keeps the plan it had — the plan as it is now, since a change acts only from the current period on. Called
 * under the budget's row lock. «Обов'язкова» is the categories' attribute (BUD-01 FR 11) as it is at that moment.
 */
export async function ensureSnapshots(
  tx: BudgetTx,
  householdId: string,
  budget: StoredBudget,
  today: string,
  categories: ReadonlyMap<string, BudgetCategory>,
): Promise<void> {
  const missing = periodsToSnapshot(
    budget.firstPeriod,
    today,
    new Set((await tx.snapshots(householdId, budget.id)).keys()),
  );
  if (missing.length === 0) return;
  const plan = livePlan(budget, await tx.limits(householdId, budget.id), categories);
  for (const p of missing) await tx.insertSnapshot(householdId, budget.id, p, planOf(budget, p, plan));
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
): PeriodPlan {
  return {
    incomePlan: budget.incomePlan,
    plannedSavings: Money.zero(budget.currency),
    limits: limits.map((l) => ({ ...l, mandatory: categories.get(l.categoryId)?.essential ?? false })),
  };
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
    readonly limits?: readonly LimitInput[] | undefined;
  },
  categories: ReadonlyMap<string, BudgetCategory>,
): Promise<Handed<Result<StoredBudget>>> {
  const currency = deps.reportingCurrency;
  const issues: BudgetIssue[] = [];
  if (!isPeriod(input.firstPeriod) || !firstPeriodChoices(deps.today()).includes(input.firstPeriod))
    issues.push({ field: "firstPeriod", issue: "invalid" });
  const today = deps.today();
  const proportional = startChoices(today).choices.find((c) => c.start === "proportional");
  if (input.proportional === true && proportional?.firstPeriod !== input.firstPeriod)
    issues.push({ field: "proportional", issue: "invalid" });
  const income = input.incomePlan
    ? parseBudgetAmount("incomePlan", input.incomePlan, currency)
    : Money.zero(currency);
  if (!(income instanceof Money)) issues.push(income);
  const checked = checkLimits(input.limits ?? [], categories, currency);
  issues.push(...checked.issues);
  if (issues.length > 0 || !(income instanceof Money))
    return { result: { kind: "invalid", issues }, handOffs: [] };
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
          limitChange(l.categoryId, null, l.amount),
        ),
      );
    }
  for (const h of handOffs) await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: budget }, handOffs };
}

/**
 * FR 7, FR 8, AC4, AC16: set, change or remove limits and change the income plan, from the current period on; finished
 * periods keep their snapshots; nothing carries over between months. `version` — the budget as the page read it.
 */
export async function updatePlan(
  deps: BudgetDeps,
  tx: BudgetTx,
  caller: Caller,
  version: number,
  patch: {
    readonly incomePlan?: { readonly amount: string; readonly currency: string } | undefined;
    readonly limits?: readonly LimitInput[] | undefined;
  },
  categories: ReadonlyMap<string, BudgetCategory>,
): Promise<Handed<Result<StoredBudget>>> {
  const budget = await tx.budget(caller.householdId, true);
  if (!budget) return { result: { kind: "not-found" }, handOffs: [] };
  if (budget.version !== version)
    return { result: { kind: "conflict", version: budget.version }, handOffs: [] };
  const issues: BudgetIssue[] = [];
  const income = patch.incomePlan
    ? parseBudgetAmount("incomePlan", patch.incomePlan, budget.currency)
    : budget.incomePlan;
  if (!(income instanceof Money)) issues.push(income);
  const checked = checkLimits(patch.limits ?? [], categories, budget.currency);
  issues.push(...checked.issues);
  if (issues.length > 0 || !(income instanceof Money))
    return { result: { kind: "invalid", issues }, handOffs: [] };
  await ensureSnapshots(tx, caller.householdId, budget, deps.today(), categories);
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
        limitChange(l.categoryId, before, l.amount),
      ),
    );
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
  const updated = await tx.updateBudget(caller.householdId, budget.id, income);
  for (const h of handOffs) await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: updated }, handOffs };
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
  await ensureSnapshots(tx, caller.householdId, budget, deps.today(), categories);
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
        limitChange(l.categoryId, l.amount, null),
      ),
    ),
  ];
  for (const h of handOffs) await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: null }, handOffs };
}

/**
 * The plan a period shows (FR 11, FR 16): a finished one — its snapshot (written now if this is its first view); the
 * current and future ones — the plan as it is. Null — a period before the first one (edge case 5).
 */
export async function periodPlan(
  deps: Pick<BudgetDeps, "today">,
  tx: BudgetTx,
  householdId: string,
  budget: StoredBudget,
  period: Period,
  categories: ReadonlyMap<string, BudgetCategory>,
): Promise<PeriodPlan | null> {
  if (period < budget.firstPeriod) return null;
  const today = deps.today();
  if (periodMode(period, today) !== "past")
    return planOf(budget, period, livePlan(budget, await tx.limits(householdId, budget.id), categories));
  let snapshot = (await tx.snapshots(householdId, budget.id)).get(period);
  if (!snapshot) {
    const locked = await tx.budget(householdId, true);
    if (!locked) return null;
    await ensureSnapshots(tx, householdId, locked, today, categories);
    snapshot = (await tx.snapshots(householdId, budget.id)).get(period);
  }
  return snapshot ?? null;
}

/**
 * BUD-16@PoC FR 4: the plans of many months in one budget transaction — as `periodPlan` for each, with one snapshot
 * pass (under the budget's row lock) when a finished month has none yet. Null — a month before the first one.
 */
export async function periodPlans(
  deps: Pick<BudgetDeps, "today">,
  tx: BudgetTx,
  householdId: string,
  budget: StoredBudget,
  periods: readonly Period[],
  categories: ReadonlyMap<string, BudgetCategory>,
): Promise<ReadonlyMap<Period, PeriodPlan | null>> {
  const today = deps.today();
  let snapshots = await tx.snapshots(householdId, budget.id);
  const finished = periods.filter((p) => p >= budget.firstPeriod && periodMode(p, today) === "past");
  if (finished.some((p) => !snapshots.has(p))) {
    const locked = await tx.budget(householdId, true);
    if (locked) await ensureSnapshots(tx, householdId, locked, today, categories);
    snapshots = await tx.snapshots(householdId, budget.id);
  }
  const live = livePlan(budget, await tx.limits(householdId, budget.id), categories);
  const out = new Map<Period, PeriodPlan | null>();
  for (const p of periods)
    out.set(
      p,
      p < budget.firstPeriod
        ? null
        : periodMode(p, today) === "past"
          ? (snapshots.get(p) ?? null)
          : planOf(budget, p, live),
    );
  return out;
}
