import { Decimal, Money } from "@willowsum/domain-kernel";
import { parseAnnualRate, parseTypedAmount } from "../../liabilities/index.ts";
import {
  addMonths,
  monthsBetween,
  ONE_OFFS_MAX,
  paidPercent,
  planDeviation,
  simulate,
  simulateStrategy,
  type Assumptions,
  type Month,
  type Outcome,
  type PayoffResult,
  type PlanStatus,
  type StrategyResult,
} from "../domain/index.ts";

/**
 * «Борги» (BUD-19@PoC FR 1–7, FR 11; wave 2 row 33): the debts of the space with their base calculation and progress,
 * a scenario, the strategies and the saved plans. A calculation never changes the liability (FR 2): it reads it and
 * overrides it in the scenario only. The product makes no payments (FR 5).
 */

/** A credit card or a loan of the space (FR 11), from modules accounts, liabilities and ledger. */
export interface Debt {
  readonly accountId: string;
  readonly kind: "credit-card" | "loan";
  readonly name: string;
  readonly currency: string;
  /** What is owed today, positive (the journal's natural balance of the account's liability wallet). */
  readonly balance: Money;
  /** What was owed at the end of last month: the «План» column (FR 7). */
  readonly balanceLastMonth: Money;
  /** «Погашено N %» is of this (FR 7): the largest debt at a month's end since the opening balance. */
  readonly startBalance: Money;
  readonly annualRate: string | null;
  readonly monthlyPayment: Money | null;
  /**
   * A credit card's «Зменшувати на … / міс.» (FLW-44@PoC FR 1, FR 4; BUD-19@PoC FR 2; owner decision 2026-11-27): what the
   * user pays off the card each month — a plan setting, the monthly payment of the card's saved plan (`withCardAmounts`),
   * never the account's data. Null (or left out) — not given yet; always null for a loan.
   */
  readonly cardMonthlyAmount?: Money | null;
}

/** A credit card has no rate and no regular payment of its own: its payment is the user's amount (FLW-44 FR 1). */
export const isCard = (debt: Pick<Debt, "kind">): boolean => debt.kind === "credit-card";

/** The rate a card is calculated at: none, so no interest (FLW-44@PoC FR 1 «відсотки по ній не рахуються»). */
export const CARD_RATE = "0";

/**
 * The debts with each card's «Зменшувати на … / міс.» from its saved plan (Рішення ведучого (2026-11-27; власник не
 * схвалював; FLW-44 code): the amount is the payment of the card's plan — «Зберегти план» keeps it, deleting the plan
 * clears it; no new table).
 */
export function withCardAmounts(debts: readonly Debt[], plans: readonly StoredPlan[]): Debt[] {
  return debts.map((d) => {
    if (!isCard(d)) return d;
    const plan = plans.find((p) => p.accountId === d.accountId && p.currency === d.currency);
    return { ...d, cardMonthlyAmount: plan?.monthlyPayment ?? null };
  });
}

/** What the routes read the debts from (adapters/http/services.ts). */
export interface DebtSource {
  debts(householdId: string, today: string): Promise<readonly Debt[]>;
}

export interface Issue {
  readonly field: string;
  readonly issue: string;
}

export type Result<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "invalid"; readonly issues: readonly Issue[] }
  | { readonly kind: "not-found" }
  /** A plan is saved only when the debt is paid off in it (lead decision). */
  | { readonly kind: "not-paid-off"; readonly reason: "not-decreasing" | "over-limit" };

/** The scenario's overrides (FR 2, FR 4): plain decimals in the debt's currency; left out — the liability's. */
export interface ScenarioInput {
  readonly balance?: string | undefined;
  readonly annualRate?: string | undefined;
  readonly monthlyPayment?: string | undefined;
  readonly extraMonthly?: string | undefined;
  readonly oneOffs?: readonly { readonly month: string; readonly amount: string }[] | undefined;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const currentMonth = (today: string): Month => today.slice(0, 7);

/** The assumptions of a scenario of the debt; the one-offs by month (1 = the month after `month`). */
export function assumptionsOf(debt: Debt, input: ScenarioInput, month: Month): Result<Assumptions> {
  const issues: Issue[] = [];
  const amount = (field: string, text: string | undefined, fallback: Money | null, positive = false) => {
    if (text === undefined) return fallback;
    const m = parseTypedAmount(text, debt.currency);
    if (m === null || (positive && m.isZero())) issues.push({ field, issue: "invalid" });
    return m;
  };
  // A negative journal balance (an overpaid liability) is no debt: clamped to zero, as the plans' check `balance >= 0` needs (#325 item 3).
  const balance = amount(
    "balance",
    input.balance,
    debt.balance.isNegative() ? Money.zero(debt.currency) : debt.balance,
  );
  const card = isCard(debt);
  // FLW-44@PoC FR 1: a card's payment is its «Зменшувати на … / міс.»; the scenario may still override it (FR 2).
  const monthlyPayment = amount(
    "monthlyPayment",
    input.monthlyPayment,
    card ? (debt.cardMonthlyAmount ?? null) : debt.monthlyPayment,
    true,
  );
  const extraMonthly = amount("extraMonthly", input.extraMonthly, Money.zero(debt.currency));
  let annualRate = card ? CARD_RATE : debt.annualRate;
  // FLW-44@PoC «Гілки та помилки»: a card has no rate, so none can be given for it.
  if (card && input.annualRate !== undefined) issues.push({ field: "annualRate", issue: "not_applicable" });
  else if (input.annualRate !== undefined) {
    annualRate = parseAnnualRate(input.annualRate);
    if (annualRate === null) issues.push({ field: "annualRate", issue: "invalid" });
  }
  // FR 2, AC5: «Вкажіть ставку і платіж, щоб розрахувати план».
  if (annualRate === null && input.annualRate === undefined)
    issues.push({ field: "annualRate", issue: "required" });
  if (monthlyPayment === null && input.monthlyPayment === undefined)
    issues.push({ field: "monthlyPayment", issue: "required" });
  const oneOffs = (input.oneOffs ?? []).map((o, i) => {
    const at = MONTH_RE.test(o.month) ? monthsBetween(month, o.month) : 0;
    if (at < 1) issues.push({ field: `oneOffs.${i}.month`, issue: "invalid" });
    const m = parseTypedAmount(o.amount, debt.currency);
    if (m === null || m.isZero()) issues.push({ field: `oneOffs.${i}.amount`, issue: "invalid" });
    return { month: at, amount: m ?? Money.zero(debt.currency) };
  });
  if (oneOffs.length > ONE_OFFS_MAX) issues.push({ field: "oneOffs", issue: "too_many" });
  if (issues.length > 0 || !balance || !monthlyPayment || !extraMonthly || annualRate === null)
    return { kind: "invalid", issues };
  return { kind: "ok", value: { balance, annualRate, monthlyPayment, extraMonthly, oneOffs } };
}

const baseOf = (a: Assumptions): Assumptions => ({
  ...a,
  extraMonthly: Money.zero(a.balance.currency),
  oneOffs: [],
});

export interface Scenario {
  readonly assumptions: Assumptions;
  readonly base: Outcome<PayoffResult>;
  readonly scenario: Outcome<PayoffResult>;
  /** «На N міс. раніше, економія на відсотках X €» (FR 4, AC2): when both are paid off. */
  readonly saving: { readonly months: number; readonly interest: Money } | null;
}

/** FR 4: the scenario next to its base (the same balance, rate and payment, without the extra and one-off payments). */
export function scenarioOf(assumptions: Assumptions): Scenario {
  const base = simulate(baseOf(assumptions));
  const scenario = simulate(assumptions);
  const saving =
    base.kind === "paid" && scenario.kind === "paid"
      ? { months: base.months - scenario.months, interest: base.totalInterest.minus(scenario.totalInterest) }
      : null;
  return { assumptions, base, scenario, saving };
}

/**
 * FR 1, AC1: the calculation by the liability's own terms; null without a rate or a payment (AC5). A card: by its
 * «Зменшувати на … / міс.», with no interest — the balance ÷ the amount, rounded up, the last month the rest (FLW-44@PoC
 * FR 1, AC9); null without the amount.
 */
export function simulateBase(debt: Debt): Outcome<PayoffResult> | null {
  const annualRate = isCard(debt) ? CARD_RATE : debt.annualRate;
  const monthlyPayment = isCard(debt) ? (debt.cardMonthlyAmount ?? null) : debt.monthlyPayment;
  if (annualRate === null || monthlyPayment === null) return null;
  return simulate({
    balance: debt.balance,
    annualRate,
    monthlyPayment,
    extraMonthly: Money.zero(debt.currency),
    oneOffs: [],
  });
}

/** A saved plan (FR 5): its assumptions and result. One per debt; saving again replaces it (lead decision). */
export interface StoredPlan {
  readonly id: string;
  readonly accountId: string;
  readonly currency: string;
  /** The month it was saved in: its month 1 is the next one. */
  readonly startMonth: Month;
  readonly balance: Money;
  readonly annualRate: string;
  readonly monthlyPayment: Money;
  readonly extraMonthly: Money;
  readonly oneOffs: readonly { readonly month: Month; readonly amount: Money }[];
  readonly months: number;
  readonly totalInterest: Money;
  readonly payoffMonth: Month;
  /** «Додати до запланованих витрат»: the extra payment is a planned expense up to the payoff month. */
  readonly addToPlannedExpenses: boolean;
  readonly version: number;
}

/** The assumptions of a saved plan, recomputed the same way (the calculation is deterministic). */
export function planAssumptions(p: StoredPlan): Assumptions {
  return {
    balance: p.balance,
    annualRate: p.annualRate,
    monthlyPayment: p.monthlyPayment,
    extraMonthly: p.extraMonthly,
    oneOffs: p.oneOffs.map((o) => ({ month: monthsBetween(p.startMonth, o.month), amount: o.amount })),
  };
}

export interface Progress {
  readonly paidPercent: number;
  /** «Залишилось N міс.» by the regular payments; null without them or when the debt does not decrease. */
  readonly remainingMonths: number | null;
  /** The «План» column; null — «Плану немає». */
  readonly plan: { readonly status: PlanStatus; readonly amount: Money } | null;
}

/** «Прогрес» of a debt (FR 7, AC8). */
export function progressOf(debt: Debt, plan: StoredPlan | null, month: Month): Progress {
  const base = simulateBase(debt);
  const remainingMonths = base?.kind === "paid" ? base.months : null;
  let deviation: Progress["plan"] = null;
  if (plan) {
    const at = monthsBetween(plan.startMonth, month);
    const r = simulate(planAssumptions(plan));
    const balances = r.kind === "paid" ? r.balances : [];
    const zero = Money.zero(plan.currency);
    // In the month it was saved the plan has paid nothing yet: «За планом» (lead decision).
    deviation =
      at < 1
        ? { status: "on-track", amount: zero }
        : planDeviation(
            at === 1 ? plan.balance : (balances[at - 2] ?? zero),
            balances[at - 1] ?? zero,
            debt.balanceLastMonth,
            debt.balance,
          );
  }
  return { paidPercent: paidPercent(debt.startBalance, debt.balance), remainingMonths, plan: deviation };
}

export interface StrategyInput {
  readonly total: Money;
  /** Overrides of the minimum payment or rate per debt (FR 2: never written to the liability). */
  readonly debts: readonly {
    readonly accountId: string;
    readonly minimumPayment?: string | undefined;
    readonly annualRate?: string | undefined;
  }[];
}

export interface StrategyView {
  readonly avalanche: Outcome<StrategyResult>;
  readonly snowball: Outcome<StrategyResult>;
  readonly included: readonly string[];
  /** AC5: a debt without a rate or a payment takes no part until they are given; another currency neither. */
  readonly excluded: readonly {
    readonly accountId: string;
    readonly reason: "terms-missing" | "currency" | "paid-off";
  }[];
}

/** «Стратегія» (FR 6, AC3): both strategies at once; the difference is the caller's to show, neutrally. */
export function strategyOf(debts: readonly Debt[], input: StrategyInput): Result<StrategyView> {
  const issues: Issue[] = [];
  const excluded: { accountId: string; reason: "terms-missing" | "currency" | "paid-off" }[] = [];
  const included: Parameters<typeof simulateStrategy>[0][number][] = [];
  input.debts.forEach((o, i) => {
    if (!debts.some((d) => d.accountId === o.accountId))
      issues.push({ field: `debts.${i}.accountId`, issue: "not_found" });
  });
  for (const d of debts) {
    const o = input.debts.find((x) => x.accountId === d.accountId);
    if (d.currency !== input.total.currency) {
      excluded.push({ accountId: d.accountId, reason: "currency" });
      continue;
    }
    const at = input.debts.indexOf(o!);
    const card = isCard(d);
    // FLW-44@PoC FR 4: a card takes part with its «Зменшувати на … / міс.» as a fixed payment and no rate.
    const own = card ? (d.cardMonthlyAmount ?? null) : d.monthlyPayment;
    const min = o?.minimumPayment !== undefined ? parseTypedAmount(o.minimumPayment, d.currency) : own;
    const rate = card ? null : o?.annualRate !== undefined ? parseAnnualRate(o.annualRate) : d.annualRate;
    if (o?.minimumPayment !== undefined && (min === null || min.isZero()))
      issues.push({ field: `debts.${at}.minimumPayment`, issue: "invalid" });
    if (card && o?.annualRate !== undefined)
      issues.push({ field: `debts.${at}.annualRate`, issue: "not_applicable" });
    else if (o?.annualRate !== undefined && rate === null)
      issues.push({ field: `debts.${at}.annualRate`, issue: "invalid" });
    if (min === null || (rate === null && !card)) {
      excluded.push({ accountId: d.accountId, reason: "terms-missing" });
      continue;
    }
    if (d.balance.isZero() || d.balance.isNegative()) {
      excluded.push({ accountId: d.accountId, reason: "paid-off" });
      continue;
    }
    included.push({ id: d.accountId, balance: d.balance, annualRate: rate, minimumPayment: min });
  }
  // The minimums' sum is compared without Money: past NUMERIC(38,18) it is still only larger than any total.
  const minimums = included.reduce((s, d) => s.plus(d.minimumPayment.amount), new Decimal("0"));
  if (issues.length === 0 && input.total.amount.lessThan(minimums))
    issues.push({ field: "total", issue: "below_minimums" });
  if (issues.length > 0) return { kind: "invalid", issues };
  return {
    kind: "ok",
    value: {
      avalanche: simulateStrategy(included, input.total, "avalanche"),
      snowball: simulateStrategy(included, input.total, "snowball"),
      included: included.map((d) => d.id),
      excluded,
    },
  };
}

/** The plans of the space in one debt-payoff transaction. */
export interface PlansTx {
  plans(householdId: string): Promise<StoredPlan[]>;
  /** The debt's plan locked until the transaction ends; serialises every save and delete of that debt. */
  lockPlan(householdId: string, accountId: string): Promise<StoredPlan | null>;
  upsertPlan(householdId: string, plan: StoredPlan): Promise<void>;
  deletePlan(householdId: string, accountId: string): Promise<void>;
  enqueueHandOff(householdId: string, handOff: PlanHandOff): Promise<void>;
}

export const PLAN_HAND_OFF_ACTIONS = ["create", "update", "delete"] as const;
export const PLAN_ENTITY = "debt-payoff.plan" as const;

/**
 * The hand-off of a plan's change to the audit log (BUD-19 «Створення, зміна і видалення збережених планів пишуться в
 * журнал аудиту»; ARC-04 FR 2, FR 3; ADR-0015): the row and this job in one debt-payoff transaction; the entry after the
 * commit. It carries the entry's values: ids, months, rates and amounts as decimal strings.
 */
export interface PlanHandOff {
  readonly entityId: string;
  readonly actorAccountId: string;
  readonly action: (typeof PLAN_HAND_OFF_ACTIONS)[number];
  readonly changeId: string;
  readonly changes: readonly {
    readonly field: string;
    readonly before: string | null;
    readonly after: string | null;
  }[];
}

export const handOffKey = (h: PlanHandOff): string =>
  `${PLAN_ENTITY}:${h.action}:${h.entityId}:${h.changeId}`;

export interface Handed<R> {
  readonly result: R;
  readonly handOffs: readonly PlanHandOff[];
}

/** The audited fields of a plan (the result too: AC6 «план зберігає припущення … і результат»). */
function fields(p: StoredPlan | null): Record<string, string | null> {
  return {
    accountId: p?.accountId ?? null,
    balance: p?.balance.toDecimalString() ?? null,
    annualRate: p?.annualRate ?? null,
    monthlyPayment: p?.monthlyPayment.toDecimalString() ?? null,
    extraMonthly: p?.extraMonthly.toDecimalString() ?? null,
    oneOffs: p ? p.oneOffs.map((o) => `${o.month}:${o.amount.toDecimalString()}`).join(",") : null,
    currency: p?.currency ?? null,
    months: p ? String(p.months) : null,
    totalInterest: p?.totalInterest.toDecimalString() ?? null,
    payoffMonth: p?.payoffMonth ?? null,
    addToPlannedExpenses: p ? String(p.addToPlannedExpenses) : null,
  };
}

function changesOf(before: StoredPlan | null, after: StoredPlan | null): PlanHandOff["changes"] {
  const b = fields(before);
  const a = fields(after);
  return Object.keys(a)
    .filter((k) => b[k] !== a[k])
    .map((k) => ({ field: k, before: b[k] ?? null, after: a[k] ?? null }));
}

export interface PlanDeps {
  readonly newId: () => string;
}

/** «Зберегти план» (FR 5, AC6): the liability is never written; one plan per debt. */
export async function savePlan(
  deps: PlanDeps,
  tx: PlansTx,
  caller: { readonly householdId: string; readonly accountId: string },
  debt: Debt,
  input: ScenarioInput & { readonly addToPlannedExpenses?: boolean | undefined },
  month: Month,
): Promise<Handed<Result<StoredPlan>>> {
  const checked = assumptionsOf(debt, input, month);
  if (checked.kind !== "ok") return { result: checked, handOffs: [] };
  const a = checked.value;
  const outcome = simulate(a);
  if (outcome.kind !== "paid")
    return { result: { kind: "not-paid-off", reason: outcome.kind }, handOffs: [] };
  const before = await tx.lockPlan(caller.householdId, debt.accountId);
  const plan: StoredPlan = {
    id: before?.id ?? deps.newId(),
    accountId: debt.accountId,
    currency: debt.currency,
    startMonth: month,
    balance: a.balance,
    annualRate: a.annualRate,
    monthlyPayment: a.monthlyPayment,
    extraMonthly: a.extraMonthly,
    oneOffs: a.oneOffs.map((o) => ({ month: addMonths(month, o.month), amount: o.amount })),
    months: outcome.months,
    totalInterest: outcome.totalInterest,
    payoffMonth: addMonths(month, outcome.months),
    addToPlannedExpenses: input.addToPlannedExpenses ?? before?.addToPlannedExpenses ?? false,
    version: (before?.version ?? 0) + 1,
  };
  const changes = changesOf(before, plan);
  if (before && changes.length === 0) return { result: { kind: "ok", value: before }, handOffs: [] };
  await tx.upsertPlan(caller.householdId, plan);
  const handOff: PlanHandOff = {
    entityId: plan.id,
    actorAccountId: caller.accountId,
    action: before ? "update" : "create",
    changeId: deps.newId(),
    changes,
  };
  await tx.enqueueHandOff(caller.householdId, handOff);
  return { result: { kind: "ok", value: plan }, handOffs: [handOff] };
}

/** Deletes the debt's saved plan; «Плану немає» after it. */
export async function deletePlan(
  deps: PlanDeps,
  tx: PlansTx,
  caller: { readonly householdId: string; readonly accountId: string },
  accountId: string,
): Promise<Handed<Result<true>>> {
  const before = await tx.lockPlan(caller.householdId, accountId);
  if (!before) return { result: { kind: "not-found" }, handOffs: [] };
  await tx.deletePlan(caller.householdId, accountId);
  const handOff: PlanHandOff = {
    entityId: before.id,
    actorAccountId: caller.accountId,
    action: "delete",
    changeId: deps.newId(),
    changes: changesOf(before, null),
  };
  await tx.enqueueHandOff(caller.householdId, handOff);
  return { result: { kind: "ok", value: true }, handOffs: [handOff] };
}

/**
 * FR 5: the plans' extra payments added to the planned expenses, in a budget month (YYYY-MM) — from the month after the
 * plan was saved up to its payoff month. For «Можна витратити» (BUD-03) and «План» (BUD-17).
 */
export function plannedExpensesIn(
  plans: readonly StoredPlan[],
  month: Month,
): { readonly accountId: string; readonly amount: Money }[] {
  return plans
    .filter(
      (p) =>
        p.addToPlannedExpenses &&
        !p.extraMonthly.isZero() &&
        monthsBetween(p.startMonth, month) >= 1 &&
        monthsBetween(month, p.payoffMonth) >= 0,
    )
    .map((p) => ({ accountId: p.accountId, amount: p.extraMonthly }));
}
