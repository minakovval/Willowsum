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

/**
 * «Витратити» (FR 8): an outgoing transaction written off from a goal (migrations/0004_spends_and_close.sql) — what it
 * took from its account, in the goal's currency, on its date; `entryId` — its journal event in effect when spent.
 */
export interface StoredSpend {
  readonly id: string;
  readonly goalId: string;
  readonly transactionId: string;
  readonly accountId: string;
  readonly entryId: string;
  readonly amount: Money;
  readonly date: string;
}

/** The goals schema inside one transaction of the module (adapters/db/store.ts). */
export interface GoalsTx {
  /** The open goals (a closed one leaves the list, FR 9). */
  goals(householdId: string): Promise<StoredGoal[]>;
  /** One open goal; `lock` — under a row lock until the commit. */
  goal(householdId: string, id: string, lock?: boolean): Promise<StoredGoal | null>;
  insertGoal(householdId: string, goal: StoredGoal): Promise<void>;
  /** Writes the fields and bumps the version. */
  updateGoal(householdId: string, goal: StoredGoal): Promise<StoredGoal>;
  /** Deletes the goal with its contributions and spends (edge case 4: the envelope is freed). */
  deleteGoal(householdId: string, id: string): Promise<void>;
  /** «Закрити ціль» (FR 9): the goal leaves the list and the card from now on. */
  closeGoal(householdId: string, id: string, closedOn: string): Promise<void>;
  contributions(householdId: string, goalIds: readonly string[]): Promise<StoredContribution[]>;
  insertContribution(householdId: string, contribution: StoredContribution): Promise<void>;
  /** The goals' spends, newest first. */
  spends(householdId: string, goalIds: readonly string[]): Promise<StoredSpend[]>;
  /** The spends of these transactions, of any goal (a closed one's too). */
  spendsOfTransactions(householdId: string, transactionIds: readonly string[]): Promise<StoredSpend[]>;
  insertSpend(householdId: string, spend: StoredSpend): Promise<void>;
  /** Deletes the goal's spend and returns it; null when there is none. */
  deleteSpend(householdId: string, goalId: string, id: string): Promise<StoredSpend | null>;
  /** Deletes the spends made on these journal events and returns them (AC5). */
  deleteSpendsOfEntries(householdId: string, entryIds: readonly string[]): Promise<StoredSpend[]>;
  /**
   * Serialises «Витратити» of these transactions until the commit, across goals (FR 8: one goal at most), so a
   * concurrent spend of the same transaction from another goal is seen and refused as `spent`, not by the index.
   */
  lockTransactions(householdId: string, transactionIds: readonly string[]): Promise<void>;
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

/**
 * The space's transactions as «Витратити» reads them (FR 8; modules `transactions`, `accounts` and `ledger`): an
 * outgoing transaction's outflow from an account in a currency, by its journal event in effect — or why there is none.
 * `not-found` — no such transaction in the space, or no such account; `transfer` — a side of a transfer between own
 * accounts; `not-posted` — no journal event in effect («Очікує», merged into another); `not-outflow` — the event takes
 * nothing from that account in that currency.
 */
export interface SpendableTransactions {
  outflow(
    householdId: string,
    transactionId: string,
    accountId: string,
    currency: string,
  ): Promise<
    | { readonly entryId: string; readonly amount: Money; readonly date: string }
    | "not-found"
    | "transfer"
    | "not-posted"
    | "not-outflow"
  >;
  /** Whether the transaction's journal event is still in effect (neither reversed nor corrected). */
  inEffect(householdId: string, transactionId: string, entryId: string): Promise<boolean>;
}

export interface GoalsDeps {
  readonly newId: () => string;
  /** «Сьогодні» — the Kyiv date. */
  readonly today: () => string;
  readonly balances: AccountBalances;
  /** «Витратити» (FR 8); null when not wired — the route answers 500. */
  readonly transactions: SpendableTransactions | null;
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
  /** FR 8: the transactions chosen take more than the goal holds (lead decision). */
  | { readonly kind: "spend-over-collected"; readonly excess: Money }
  /** The goal changed between the read of its account's balance and the write; nothing written. */
  | { readonly kind: "conflict"; readonly version: number };

/** A change and its audit hand-off, written in one goals transaction (ARC-04 FR 2; ADR-0015). */
export interface Handed<R> {
  readonly result: R;
  readonly handOffs: readonly GoalHandOff[];
}

export const GOAL_HAND_OFF_ACTIONS = ["create", "update", "delete"] as const;
export const GOAL_AUDIT_ENTITIES = ["goals.goal", "goals.contribution", "goals.spend"] as const;

/**
 * The hand-off of a goals change to the audit log (BUD-05 «Кожна зміна, внесок, списання і видалення пишуться в журнал
 * аудиту»; ARC-04 FR 2, FR 3; ADR-0015): the row and this job in one goals transaction; the entry after the commit —
 * right away and by the worker if that failed — once per key. It carries the entry's values (a delete's «before» is
 * gone once committed): ids, codes, dates, amounts as decimal strings and the goal's name.
 */
export interface GoalHandOff {
  readonly entity: (typeof GOAL_AUDIT_ENTITIES)[number];
  readonly entityId: string;
  /** Null — the system (a spend cancelled because its transaction changed, AC5). */
  readonly actorAccountId: string | null;
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
  caller: { readonly accountId: string | null },
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

/** What a goal of marks or an envelope holds: its start, its contributions, less its spends (FR 8). */
export const reservedBy = (
  g: StoredGoal,
  contributions: readonly StoredContribution[],
  spends: readonly StoredSpend[],
) =>
  sumMoney(
    contributions.filter((c) => c.goalId === g.id).map((c) => c.amount),
    g.target.currency,
  )
    .plus(g.startAmount)
    .minus(
      sumMoney(
        spends.filter((s) => s.goalId === g.id).map((s) => s.amount),
        g.target.currency,
      ),
    );

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
  const ids = envelopes.map((o) => o.id);
  const theirs = await tx.contributions(householdId, ids);
  const spent = await tx.spends(householdId, ids);
  const total = envelopes.reduce((sum, o) => sum.plus(reservedBy(o, theirs, spent)), reserved);
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
  if (checked.kind !== "ok") return { result: checked, handOffs: [] };
  await tx.insertGoal(caller.householdId, goal);
  const h = handOff(deps, caller, "goals.goal", goal.id, "create", changesOf(null, goal));
  await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: goal }, handOffs: [h] };
}

/**
 * A patched part: without a `startAmount` the stored one stays while the part stays the same (same kind, and the same
 * account of an envelope), never silently 0; a changed part starts from 0 (lead decision, #298).
 */
function mergedPart(stored: StoredGoal, part: GoalInput["part"]): NonNullable<GoalInput["part"]> {
  const keep = {
    kind: stored.partKind,
    accountId: stored.accountId,
    startAmount: stored.startAmount.toDecimalString(),
  };
  if (!part) return keep;
  if (part.startAmount !== undefined) return part;
  const same = part.kind === stored.partKind && (part.accountId ?? null) === stored.accountId;
  return same ? { ...part, startAmount: keep.startAmount } : part;
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
    part: mergedPart(stored, patch.part),
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
  if (!stored) return { result: { kind: "not-found" }, handOffs: [] };
  if (stored.version !== version)
    return { result: { kind: "conflict", version: stored.version }, handOffs: [] };
  const next: StoredGoal = { ...stored, ...fields };
  const changes = changesOf(stored, next);
  if (changes.length === 0) return { result: { kind: "ok", value: stored }, handOffs: [] };
  const own = await tx.contributions(caller.householdId, [id]);
  const spent = await tx.spends(caller.householdId, [id]);
  const sameEnvelope =
    stored.partKind === "envelope" && next.partKind === "envelope" && stored.accountId === next.accountId;
  const checked = await checkAccount(
    tx,
    caller.householdId,
    { ...next, currency: next.target.currency },
    reservedBy(next, own, spent),
    balance,
    sameEnvelope ? reservedBy(stored, own, spent) : null,
  );
  if (checked.kind !== "ok") return { result: checked, handOffs: [] };
  const updated = await tx.updateGoal(caller.householdId, next);
  const h = handOff(deps, caller, "goals.goal", id, "update", changes);
  await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: updated }, handOffs: [h] };
}

/**
 * «Видалити» (FR 13, edge case 4): the envelope is freed; the history stays in the audit log. Its spends go with it —
 * their transactions are ordinary expenses again (lead decision) — each with its own entry.
 */
export async function deleteGoal(
  deps: GoalsDeps,
  tx: GoalsTx,
  caller: Caller,
  id: string,
): Promise<Handed<Result<null>>> {
  const stored = await tx.goal(caller.householdId, id, true);
  if (!stored) return { result: { kind: "not-found" }, handOffs: [] };
  const spends = await tx.spends(caller.householdId, [id]);
  await tx.deleteGoal(caller.householdId, id);
  const handOffs = [
    handOff(deps, caller, "goals.goal", id, "delete", changesOf(stored, null)),
    ...spends.map((s) => spendHandOff(deps, caller, s, "delete", "goal-deleted")),
  ];
  for (const h of handOffs) await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: null }, handOffs };
}

/**
 * «Закрити ціль» (FR 9; FR 12 for a goal past its date; FR 13 «Закрити без витрати»): also when the target is not
 * collected. The goal leaves the list (no archive in this release), reserves nothing on its account any more, and its
 * spends stay in effect; the history stays in the audit log (an update of `closedOn`).
 */
export async function closeGoal(
  deps: GoalsDeps,
  tx: GoalsTx,
  caller: Caller,
  id: string,
): Promise<Handed<Result<null>>> {
  const stored = await tx.goal(caller.householdId, id, true);
  if (!stored) return { result: { kind: "not-found" }, handOffs: [] };
  const today = deps.today();
  await tx.closeGoal(caller.householdId, id, today);
  const h = handOff(deps, caller, "goals.goal", id, "update", [
    { field: "closedOn", before: null, after: today },
  ]);
  await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: null }, handOffs: [h] };
}

/** Why a spend was cancelled: «Скасувати витрату», its transaction changed or deleted (AC5), its goal deleted. */
export type SpendCancelReason = "manual" | "transaction-changed" | "goal-deleted";

function spendHandOff(
  deps: Pick<GoalsDeps, "newId">,
  caller: { readonly accountId: string | null },
  s: StoredSpend,
  action: "create" | "delete",
  reason?: SpendCancelReason,
): GoalHandOff {
  const values: Record<string, string> = {
    goalId: s.goalId,
    transactionId: s.transactionId,
    accountId: s.accountId,
    amount: s.amount.toDecimalString(),
    currency: s.amount.currency,
    date: s.date,
  };
  const changes = Object.entries(values).map(([field, v]) =>
    action === "create" ? { field, before: null, after: v } : { field, before: v, after: null },
  );
  if (reason) changes.push({ field: "reason", before: null, after: reason });
  return handOff(deps, caller, "goals.spend", s.id, action, changes);
}

/** A transaction chosen in «Витратити», as resolved before the goals transaction. */
export interface SpendCandidate {
  readonly transactionId: string;
  readonly accountId: string;
  readonly entryId: string;
  readonly amount: Money;
  readonly date: string;
}

/** The most transactions one «Витратити» writes off. */
export const SPEND_MAX = 50;

/**
 * FR 8: each chosen transaction is an outflow of the goal's currency — from the part's account, or from any account of
 * the space for a goal of marks only — by its journal event in effect. Read before the goals transaction (the pools of
 * `transactions`, `accounts` and `ledger`).
 */
export async function resolveSpend(
  spendable: SpendableTransactions,
  householdId: string,
  goal: StoredGoal,
  chosen: readonly { readonly transactionId: string; readonly accountId: string }[],
): Promise<Result<SpendCandidate[]>> {
  const issues: GoalIssue[] = [];
  const candidates: SpendCandidate[] = [];
  const seen = new Set<string>();
  for (const [i, c] of chosen.entries()) {
    const field = `transactions.${i}`;
    if (seen.has(c.transactionId)) {
      issues.push({ field, issue: "duplicate" });
      continue;
    }
    seen.add(c.transactionId);
    if (goal.partKind !== "marks" && c.accountId !== goal.accountId) {
      issues.push({ field, issue: "not_goal_account" });
      continue;
    }
    const out = await spendable.outflow(householdId, c.transactionId, c.accountId, goal.target.currency);
    if (typeof out === "string") issues.push({ field, issue: out.replace("-", "_") });
    else candidates.push({ ...c, ...out });
  }
  return issues.length > 0 ? { kind: "invalid", issues } : { kind: "ok", value: candidates };
}

/**
 * «Витратити» (FR 8, AC2): the chosen transactions are written off from the goal — they no longer lower «Можна
 * витратити» and show «з цілі». A transaction is spent once, from one goal. A goal of marks or an envelope gives at
 * most what it holds (lead decision); an own account's balance is what it holds, and the spend already took from it.
 */
export async function spendFromGoal(
  deps: GoalsDeps,
  tx: GoalsTx,
  caller: Caller,
  id: string,
  version: number,
  candidates: readonly SpendCandidate[],
): Promise<Handed<Result<StoredSpend[]>>> {
  const goal = await tx.goal(caller.householdId, id, true);
  if (!goal) return { result: { kind: "not-found" }, handOffs: [] };
  if (goal.version !== version) return { result: { kind: "conflict", version: goal.version }, handOffs: [] };
  await tx.lockTransactions(
    caller.householdId,
    candidates.map((c) => c.transactionId),
  );
  const taken = new Set(
    (
      await tx.spendsOfTransactions(
        caller.householdId,
        candidates.map((c) => c.transactionId),
      )
    ).map((s) => s.transactionId),
  );
  const issues = candidates.flatMap((c, i) =>
    taken.has(c.transactionId) ? [{ field: `transactions.${i}`, issue: "spent" }] : [],
  );
  if (issues.length > 0) return { result: { kind: "invalid", issues }, handOffs: [] };
  const total = sumMoney(
    candidates.map((c) => c.amount),
    goal.target.currency,
  );
  if (goal.partKind !== "account") {
    const held = reservedBy(
      goal,
      await tx.contributions(caller.householdId, [id]),
      await tx.spends(caller.householdId, [id]),
    );
    const excess = total.minus(held);
    if (!excess.isNegative() && !excess.isZero())
      return { result: { kind: "spend-over-collected", excess }, handOffs: [] };
  }
  const spends = candidates.map((c): StoredSpend => ({ ...c, id: deps.newId(), goalId: id }));
  const handOffs: GoalHandOff[] = [];
  for (const s of spends) {
    await tx.insertSpend(caller.householdId, s);
    handOffs.push(spendHandOff(deps, caller, s, "create"));
  }
  for (const h of handOffs) await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: spends }, handOffs };
}

/** «Скасувати витрату» (FR 8, AC5): the spend is cancelled, the transaction stays as it is; its amount goes back. */
export async function cancelSpend(
  deps: GoalsDeps,
  tx: GoalsTx,
  caller: Caller,
  goalId: string,
  spendId: string,
): Promise<Handed<Result<null>>> {
  const goal = await tx.goal(caller.householdId, goalId, true);
  if (!goal) return { result: { kind: "not-found" }, handOffs: [] };
  const spend = await tx.deleteSpend(caller.householdId, goalId, spendId);
  if (!spend) return { result: { kind: "not-found" }, handOffs: [] };
  const h = spendHandOff(deps, caller, spend, "delete", "manual");
  await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: null }, handOffs: [h] };
}

/**
 * AC5, edge case 5: the journal reversed these events — their transactions were changed or deleted by hand or by a
 * repeated import — so the spends made on them are cancelled by the system and their amounts go back to the goals.
 * Idempotent: a spend already cancelled is not there.
 */
export async function cancelSpendsOfEntries(
  deps: Pick<GoalsDeps, "newId">,
  tx: GoalsTx,
  householdId: string,
  entryIds: readonly string[],
): Promise<GoalHandOff[]> {
  if (entryIds.length === 0) return [];
  const cancelled = await tx.deleteSpendsOfEntries(householdId, entryIds);
  const handOffs = cancelled.map((s) =>
    spendHandOff(deps, { accountId: null }, s, "delete", "transaction-changed"),
  );
  for (const h of handOffs) await tx.enqueueHandOff(h);
  return handOffs;
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
  if (!goal) return { result: { kind: "not-found" }, handOffs: [] };
  if (goal.version !== version) return { result: { kind: "conflict", version: goal.version }, handOffs: [] };
  if (goal.partKind === "account") return { result: { kind: "own-account" }, handOffs: [] };
  const checked = checkContribution(
    input,
    { currency: goal.target.currency, createdOn: goal.createdOn },
    deps.today(),
  );
  if (checked.kind === "invalid") return { result: checked, handOffs: [] };
  const own = await tx.contributions(caller.householdId, [id]);
  const spent = await tx.spends(caller.householdId, [id]);
  const fits = await checkAccount(
    tx,
    caller.householdId,
    { ...goal, currency: goal.target.currency },
    reservedBy(goal, own, spent).plus(checked.amount),
    balance,
  );
  if (fits.kind !== "ok") return { result: fits, handOffs: [] };
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
  return { result: { kind: "ok", value: contribution }, handOffs: [h] };
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
  /** «Витратити» (FR 8): the transactions written off from the goal, newest first. */
  readonly spends: readonly StoredSpend[];
}

/** Every goal of the space with what it shows; the balances of the parts' accounts are read on `today`. */
export async function viewGoals(
  deps: GoalsDeps,
  householdId: string,
  goals: readonly StoredGoal[],
  contributions: readonly StoredContribution[],
  spends: readonly StoredSpend[],
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
        (reserved.get(key) ?? Money.zero(g.target.currency)).plus(reservedBy(g, contributions, spends)),
      );
    }
  const views: GoalView[] = [];
  for (const g of goals) {
    const currency = g.target.currency;
    // Newest first, as the store reads them.
    const own = contributions.filter((c) => c.goalId === g.id);
    const spent = spends.filter((s) => s.goalId === g.id);
    const spentSince = (date: string) =>
      sumMoney(
        spent.filter((s) => s.date >= date).map((s) => s.amount),
        currency,
      );
    const windowStart = paceWindowStart(g.createdOn, today);
    let collected: Money;
    let cameIn: Money;
    let thisMonth: Money;
    let freeBalance: Money | null = null;
    if (g.partKind === "account") {
      // The spends already took from the balance (collected); a spend is no negative contribution (lead decision).
      collected = await balance(g, today);
      cameIn = collected.minus(await balance(g, addDays(windowStart, -1))).plus(spentSince(windowStart));
      thisMonth = collected.minus(await balance(g, addDays(monthStart, -1))).plus(spentSince(monthStart));
      if (thisMonth.isNegative()) thisMonth = Money.zero(currency);
    } else {
      collected = reservedBy(g, contributions, spends);
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
      spends: spent,
    });
  }
  return views;
}

export type { GoalTemplate, PartKind };
