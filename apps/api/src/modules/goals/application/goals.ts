import { Money, sumMoney } from "@willowsum/domain-kernel";
import {
  addDays,
  checkContribution,
  checkGoal,
  envelopeExcess,
  goalProgress,
  paceWindowStart,
  type GoalFields,
  type GoalInput,
  type GoalIssue,
  type GoalProgress,
  type GoalTemplate,
  type PartKind,
} from "../domain/index.ts";

/** A goal as stored (migrations/0001_goals.sql). */
export interface StoredGoal extends GoalFields {
  readonly id: string;
  readonly createdOn: string;
  readonly version: number;
}

export interface StoredContribution {
  readonly id: string;
  readonly goalId: string;
  readonly amount: Money;
  readonly date: string;
}

/** The goals schema inside one transaction of the module (adapters/db/store.ts). */
export interface GoalsTx {
  goals(householdId: string): Promise<StoredGoal[]>;
  /** One goal; `lock` — under a row lock until the commit. */
  goal(householdId: string, id: string, lock?: boolean): Promise<StoredGoal | null>;
  insertGoal(householdId: string, goal: StoredGoal): Promise<void>;
  /** Writes the fields and bumps the version. */
  updateGoal(householdId: string, goal: StoredGoal): Promise<StoredGoal>;
  /** Deletes the goal with its contributions (edge case 4: the envelope is freed). */
  deleteGoal(householdId: string, id: string): Promise<void>;
  contributions(householdId: string, goalIds: readonly string[]): Promise<StoredContribution[]>;
  insertContribution(householdId: string, contribution: StoredContribution): Promise<void>;
  /** Serialises the changes of one account's envelopes and own goal until the commit (FR 2, FR 3). */
  lockAccount(householdId: string, accountId: string): Promise<void>;
  /** The other goals with a part on the account (`exceptGoalId` left out). */
  goalsOnAccount(householdId: string, accountId: string, exceptGoalId: string | null): Promise<StoredGoal[]>;
  enqueueHandOff(handOff: GoalHandOff): Promise<void>;
}

/**
 * An account's balance as a goal's part reads it (module `accounts` for the account, `ledger` for the balance): the
 * balance of its currency on a date, or why there is none — another space's or an unknown account is `not-found`, a
 * closed one `closed`, an account without that currency `currency`.
 */
export interface AccountBalances {
  balance(
    householdId: string,
    accountId: string,
    currency: string,
    date: string,
  ): Promise<Money | "not-found" | "closed" | "currency">;
}

export interface GoalsDeps {
  readonly newId: () => string;
  /** «Сьогодні» — the Kyiv date. */
  readonly today: () => string;
  readonly balances: AccountBalances;
}

export interface Caller {
  readonly householdId: string;
  readonly accountId: string;
}

export type Result<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "invalid"; readonly issues: readonly GoalIssue[] }
  | { readonly kind: "not-found" }
  /** FR 2: the account is another goal's own account, or has envelopes while it would become one. */
  | { readonly kind: "account-taken" }
  /** FR 3: «Сума конвертів перевищує залишок рахунку на N €». */
  | { readonly kind: "envelopes-over-balance"; readonly excess: Money }
  /** FR 6: an own account's goal has no «Внести»: its contributions are transfers to the account. */
  | { readonly kind: "own-account" }
  /** The goal changed between the read of its account's balance and the write; nothing written. */
  | { readonly kind: "conflict"; readonly version: number };

/** A change and its audit hand-off, written in one goals transaction (ARC-04 FR 2; ADR-0015). */
export interface Handed<R> {
  readonly result: R;
  readonly handOff: GoalHandOff | null;
}

export const GOAL_HAND_OFF_ACTIONS = ["create", "update", "delete"] as const;
export const GOAL_AUDIT_ENTITIES = ["goals.goal", "goals.contribution"] as const;

/**
 * The hand-off of a goals change to the audit log (BUD-05 «Кожна зміна, внесок, списання і видалення пишуться в журнал
 * аудиту»; ARC-04 FR 2, FR 3; ADR-0015): the row and this job in one goals transaction; the entry after the commit —
 * right away and by the worker if that failed — once per key. It carries the entry's values (a delete's «before» is
 * gone once committed): ids, codes, dates, amounts as decimal strings and the goal's name.
 */
export interface GoalHandOff {
  readonly entity: (typeof GOAL_AUDIT_ENTITIES)[number];
  readonly entityId: string;
  readonly actorAccountId: string;
  readonly action: (typeof GOAL_HAND_OFF_ACTIONS)[number];
  /** New for each change: the key of its job and of its audit entry. */
  readonly changeId: string;
  readonly changes: readonly {
    readonly field: string;
    readonly before: string | null;
    readonly after: string | null;
  }[];
}

export const handOffKey = (h: GoalHandOff): string => `${h.entity}:${h.action}:${h.entityId}:${h.changeId}`;
/** The audit entry's key (ARC-04 FR 3). */
export const auditKey = (h: GoalHandOff): string => handOffKey(h);

/** The goal's fields as the audit log shows them. */
function auditFields(g: GoalFields): Record<string, string | null> {
  return {
    template: g.template,
    name: g.name,
    target: g.target.toDecimalString(),
    currency: g.target.currency,
    targetDate: g.targetDate,
    emergencyMonths: g.emergencyMonths === null ? null : String(g.emergencyMonths),
    partKind: g.partKind,
    accountId: g.accountId,
    startAmount: g.startAmount.toDecimalString(),
  };
}

function changesOf(before: GoalFields | null, after: GoalFields | null) {
  const b = before ? auditFields(before) : null;
  const a = after ? auditFields(after) : null;
  return Object.keys(a ?? b ?? {})
    .map((field) => ({ field, before: b?.[field] ?? null, after: a?.[field] ?? null }))
    .filter((c) => before === null || after === null || c.before !== c.after);
}

function handOff(
  deps: Pick<GoalsDeps, "newId">,
  caller: Caller,
  entity: GoalHandOff["entity"],
  entityId: string,
  action: GoalHandOff["action"],
  changes: GoalHandOff["changes"],
): GoalHandOff {
  return { entity, entityId, actorAccountId: caller.accountId, action, changeId: deps.newId(), changes };
}

/** The balance a part on an account needs (FR 2, FR 3), read before the goals transaction; null for marks. */
export async function partBalance(
  deps: GoalsDeps,
  householdId: string,
  part: { readonly partKind: PartKind; readonly accountId: string | null; readonly currency: string },
): Promise<Result<Money | null>> {
  if (part.accountId === null || part.partKind === "marks") return { kind: "ok", value: null };
  const balance = await deps.balances.balance(householdId, part.accountId, part.currency, deps.today());
  if (balance === "not-found" || balance === "closed")
    return {
      kind: "invalid",
      issues: [{ field: "part.accountId", issue: balance === "closed" ? "closed" : "not_found" }],
    };
  if (balance === "currency")
    return { kind: "invalid", issues: [{ field: "part.accountId", issue: "currency" }] };
  return { kind: "ok", value: balance };
}

const reservedBy = (g: StoredGoal, contributions: readonly StoredContribution[]) =>
  sumMoney(
    contributions.filter((c) => c.goalId === g.id).map((c) => c.amount),
    g.target.currency,
  ).plus(g.startAmount);

/**
 * Under the account's lock: FR 2 — one own goal per account, and its balance is wholly the goal's, so no envelope sits
 * beside it (lead decision); FR 3 — the envelopes of the account, with `adding` more for this goal, never exceed its
 * balance. `before` — what this goal already reserved on the same account: a change that does not reserve more is never
 * refused, so a goal whose account fell below its envelopes (edge case 1) can still be renamed, extended (FR 12) or
 * reduced.
 */
async function checkAccount(
  tx: GoalsTx,
  householdId: string,
  goal: {
    readonly id: string;
    readonly partKind: PartKind;
    readonly accountId: string | null;
    readonly currency: string;
  },
  reserved: Money,
  balance: Money | null,
  before: Money | null = null,
): Promise<Result<null>> {
  if (goal.accountId === null || goal.partKind === "marks" || balance === null)
    return { kind: "ok", value: null };
  await tx.lockAccount(householdId, goal.accountId);
  const others = await tx.goalsOnAccount(householdId, goal.accountId, goal.id);
  if (others.some((o) => o.partKind === "account") || (goal.partKind === "account" && others.length > 0))
    return { kind: "account-taken" };
  if (goal.partKind === "account") return { kind: "ok", value: null };
  const envelopes = others.filter((o) => o.partKind === "envelope" && o.target.currency === goal.currency);
  const theirs = await tx.contributions(
    householdId,
    envelopes.map((o) => o.id),
  );
  const total = envelopes.reduce((sum, o) => sum.plus(reservedBy(o, theirs)), reserved);
  const excess = envelopeExcess(balance, total);
  const growth = before === null ? null : reserved.minus(before);
  const reservesMore = growth === null || !(growth.isNegative() || growth.isZero());
  return excess && reservesMore ? { kind: "envelopes-over-balance", excess } : { kind: "ok", value: null };
}

/** «Створити ціль» (FR 2, FR 3). `balance` — `partBalance` of the checked fields. */
export async function createGoal(
  deps: GoalsDeps,
  tx: GoalsTx,
  caller: Caller,
  fields: GoalFields,
  balance: Money | null,
): Promise<Handed<Result<StoredGoal>>> {
  const goal: StoredGoal = { ...fields, id: deps.newId(), createdOn: deps.today(), version: 1 };
  const checked = await checkAccount(
    tx,
    caller.householdId,
    { ...goal, currency: goal.target.currency },
    goal.startAmount,
    balance,
  );
  if (checked.kind !== "ok") return { result: checked, handOff: null };
  await tx.insertGoal(caller.householdId, goal);
  const h = handOff(deps, caller, "goals.goal", goal.id, "create", changesOf(null, goal));
  await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: goal }, handOff: h };
}

/** «Змінити ціль» (FR 2): the merged fields checked as a new goal's; the currency stays (lead decision). */
export function mergeGoal(
  stored: StoredGoal,
  patch: { readonly [K in keyof GoalInput]?: GoalInput[K] | undefined },
  today: string,
):
  | { readonly kind: "ok"; readonly fields: GoalFields }
  | { readonly kind: "invalid"; readonly issues: GoalIssue[] } {
  if (patch.target && patch.target.currency !== stored.target.currency)
    return { kind: "invalid", issues: [{ field: "target.currency", issue: "fixed" }] };
  const input: GoalInput = {
    template: patch.template ?? stored.template,
    name: patch.name ?? stored.name,
    target: patch.target ?? { amount: stored.target.toDecimalString(), currency: stored.target.currency },
    targetDate: patch.targetDate !== undefined ? patch.targetDate : stored.targetDate,
    emergencyMonths:
      patch.emergencyMonths !== undefined
        ? patch.emergencyMonths
        : (patch.template ?? stored.template) === "emergency"
          ? stored.emergencyMonths
          : null,
    part: patch.part ?? {
      kind: stored.partKind,
      accountId: stored.accountId,
      startAmount: stored.startAmount.toDecimalString(),
    },
  };
  return checkGoal(input, today, stored.targetDate);
}

/** Writes a merged goal, unless it changed since `version` (its account's balance was read for that one). */
export async function updateGoal(
  deps: GoalsDeps,
  tx: GoalsTx,
  caller: Caller,
  id: string,
  version: number,
  fields: GoalFields,
  balance: Money | null,
): Promise<Handed<Result<StoredGoal>>> {
  const stored = await tx.goal(caller.householdId, id, true);
  if (!stored) return { result: { kind: "not-found" }, handOff: null };
  if (stored.version !== version)
    return { result: { kind: "conflict", version: stored.version }, handOff: null };
  const next: StoredGoal = { ...stored, ...fields };
  const changes = changesOf(stored, next);
  if (changes.length === 0) return { result: { kind: "ok", value: stored }, handOff: null };
  const own = await tx.contributions(caller.householdId, [id]);
  const sameEnvelope =
    stored.partKind === "envelope" && next.partKind === "envelope" && stored.accountId === next.accountId;
  const checked = await checkAccount(
    tx,
    caller.householdId,
    { ...next, currency: next.target.currency },
    reservedBy(next, own),
    balance,
    sameEnvelope ? reservedBy(stored, own) : null,
  );
  if (checked.kind !== "ok") return { result: checked, handOff: null };
  const updated = await tx.updateGoal(caller.householdId, next);
  const h = handOff(deps, caller, "goals.goal", id, "update", changes);
  await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: updated }, handOff: h };
}

/** «Видалити» (FR 13, edge case 4): the envelope is freed; the history stays in the audit log. */
export async function deleteGoal(
  deps: GoalsDeps,
  tx: GoalsTx,
  caller: Caller,
  id: string,
): Promise<Handed<Result<null>>> {
  const stored = await tx.goal(caller.householdId, id, true);
  if (!stored) return { result: { kind: "not-found" }, handOff: null };
  await tx.deleteGoal(caller.householdId, id);
  const h = handOff(deps, caller, "goals.goal", id, "delete", changesOf(stored, null));
  await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: null }, handOff: h };
}

/** «Внести» (FR 6): a manual mark; over the target too. An envelope's mark reserves more of its account (FR 3). */
export async function contribute(
  deps: GoalsDeps,
  tx: GoalsTx,
  caller: Caller,
  id: string,
  version: number,
  input: Parameters<typeof checkContribution>[0],
  balance: Money | null,
): Promise<Handed<Result<StoredContribution>>> {
  const goal = await tx.goal(caller.householdId, id, true);
  if (!goal) return { result: { kind: "not-found" }, handOff: null };
  if (goal.version !== version) return { result: { kind: "conflict", version: goal.version }, handOff: null };
  if (goal.partKind === "account") return { result: { kind: "own-account" }, handOff: null };
  const checked = checkContribution(
    input,
    { currency: goal.target.currency, createdOn: goal.createdOn },
    deps.today(),
  );
  if (checked.kind === "invalid") return { result: checked, handOff: null };
  const own = await tx.contributions(caller.householdId, [id]);
  const fits = await checkAccount(
    tx,
    caller.householdId,
    { ...goal, currency: goal.target.currency },
    reservedBy(goal, own).plus(checked.amount),
    balance,
  );
  if (fits.kind !== "ok") return { result: fits, handOff: null };
  const contribution: StoredContribution = {
    id: deps.newId(),
    goalId: id,
    amount: checked.amount,
    date: checked.date,
  };
  await tx.insertContribution(caller.householdId, contribution);
  const h = handOff(deps, caller, "goals.contribution", contribution.id, "create", [
    { field: "goalId", before: null, after: id },
    { field: "amount", before: null, after: checked.amount.toDecimalString() },
    { field: "currency", before: null, after: checked.amount.currency },
    { field: "date", before: null, after: checked.date },
  ]);
  await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: contribution }, handOff: h };
}

/** A goal as the list and the card show it (FR 4–7, FR 12, FR 13). */
export interface GoalView {
  readonly goal: StoredGoal;
  readonly progress: GoalProgress;
  /** An envelope's account: its balance minus every envelope on it (FR 3; negative — edge case 1). */
  readonly freeBalance: Money | null;
  /** «Внести» this month (FR 5: «мінус уже внесене в цьому місяці»); for an own account its growth this month. */
  readonly contributedThisMonth: Money;
  /** History, newest first; none for an own account (its contributions are its balance's growth). */
  readonly contributions: readonly StoredContribution[];
}

/** Every goal of the space with what it shows; the balances of the parts' accounts are read on `today`. */
export async function viewGoals(
  deps: GoalsDeps,
  householdId: string,
  goals: readonly StoredGoal[],
  contributions: readonly StoredContribution[],
): Promise<GoalView[]> {
  const today = deps.today();
  const monthStart = `${today.slice(0, 7)}-01`;
  const balance = async (g: StoredGoal, date: string) => {
    const b = await deps.balances.balance(householdId, g.accountId!, g.target.currency, date);
    return typeof b === "string" ? Money.zero(g.target.currency) : b;
  };
  const reserved = new Map<string, Money>();
  for (const g of goals)
    if (g.partKind === "envelope") {
      const key = `${g.accountId}/${g.target.currency}`;
      reserved.set(
        key,
        (reserved.get(key) ?? Money.zero(g.target.currency)).plus(reservedBy(g, contributions)),
      );
    }
  const views: GoalView[] = [];
  for (const g of goals) {
    const currency = g.target.currency;
    // Newest first, as the store reads them.
    const own = contributions.filter((c) => c.goalId === g.id);
    const windowStart = paceWindowStart(g.createdOn, today);
    let collected: Money;
    let cameIn: Money;
    let thisMonth: Money;
    let freeBalance: Money | null = null;
    if (g.partKind === "account") {
      collected = await balance(g, today);
      cameIn = collected.minus(await balance(g, addDays(windowStart, -1)));
      thisMonth = collected.minus(await balance(g, addDays(monthStart, -1)));
      if (thisMonth.isNegative()) thisMonth = Money.zero(currency);
    } else {
      collected = reservedBy(g, contributions);
      cameIn = sumMoney(
        own.filter((c) => c.date >= windowStart).map((c) => c.amount),
        currency,
      );
      thisMonth = sumMoney(
        own.filter((c) => c.date >= monthStart).map((c) => c.amount),
        currency,
      );
      if (g.partKind === "envelope")
        freeBalance = (await balance(g, today)).minus(reserved.get(`${g.accountId}/${currency}`)!);
    }
    views.push({
      goal: g,
      progress: goalProgress({
        target: g.target,
        targetDate: g.targetDate,
        collected,
        cameIn,
        windowStart,
        today,
      }),
      freeBalance,
      contributedThisMonth: thisMonth,
      contributions: g.partKind === "account" ? [] : own,
    });
  }
  return views;
}

export type { GoalTemplate, PartKind };
