import { isCalendarDate, Money } from "@willowsum/domain-kernel";
import {
  balanceUpdatePlan,
  closingDateIssue,
  shownBalance,
  statementPlan,
  typedBalance,
  type AdjustmentPlan,
  type FieldIssue,
  type LiveAdjustment,
} from "../domain/index.ts";
import type { AccountsDeps, AccountsTx, Caller, StoredAccount, StoredSubaccount } from "./accounts.ts";
import { liveAdjustment, type AdjustmentView } from "./adjustments.ts";
import {
  applyMoves,
  type HandOffMove,
  type HandOffStatus,
  type ManageActor,
  type ManagedHandOff,
} from "./hand-off.ts";

/**
 * Managing an account (FIN-12@PoC FR 7–9, FR 14, FR 15; FIN-04@PoC FR 10, FR 11; wave 2 row 13): closing with the
 * balance moved to another account or written off, reopening, «Оновити залишок» and deleting its adjustment, and the
 * recount of a temporary adjustment by a statement. Each runs in the accounts transaction with the account's row
 * locked (two requests on one account run one after the other):
 *
 * 1. the journal moves of the account's earlier changes not handed over yet are finished first (ARC-04, #252 item 3),
 *    so the balance read next is the one those changes left;
 * 2. the request is checked against the account as it is — nothing is written for a refusal;
 * 3. the money to move is planned (a transfer, or the adjustment posted, corrected or reversed) and the account's state
 *    changes (closing, reopening) in this transaction;
 * 4. the hand-off job, in the same transaction (ARC-04 FR 2, hand-off.ts `managed`): once it has committed, the moves
 *    go to the journal by keys of this change, each in one ledger transaction (FIN-04 FR 2), then the audit entries —
 *    right away from the route, and from the worker if that fails.
 *
 * So a failure before the commit leaves nothing in the journal or the audit log, and a failure after it leaves the
 * change made, finished by the worker without moving anything twice (#210, #224 security review).
 *
 * The adjustment of «Оновити залишок» is a ledger event `balance-adjustment` of the subaccount against «Коригування»
 * (FIN-04 FR 7, FR 11): no income or spending. Its record is the journal itself — at most one is in effect per
 * subaccount (FIN-12 FR 14), found with `liveEntries`; a change is a correction (reversal and a new entry) and a
 * deletion its reversal, so the journal is only appended to (FIN-04 FR 5).
 */

export type ManageRefusal =
  | { readonly kind: "not-found" }
  | { readonly kind: "closed" }
  | { readonly kind: "not-closed" }
  | { readonly kind: "invalid"; readonly issues: readonly FieldIssue[] }
  | { readonly kind: "activity-after-close" }
  | { readonly kind: "balance-not-zero" }
  | { readonly kind: "postings-pending" };

export interface CurrencyBalance {
  readonly currency: string;
  readonly balance: Money;
}

const shownOn = async (
  deps: Pick<AccountsDeps, "ledger">,
  householdId: string,
  account: StoredAccount,
  s: StoredSubaccount,
  date: string,
) => shownBalance(account.kind, await deps.ledger.balanceAt(householdId, s.ledgerAccountId, date));

/** An adjustment plan as a move of the hand-off (none: no move). */
function adjustMove(
  subaccount: StoredSubaccount,
  plan: AdjustmentPlan,
  date: string,
  before: LiveAdjustment | null,
): HandOffMove | null {
  if (plan.kind === "none") return null;
  return {
    op: "adjust",
    subaccountId: subaccount.id,
    currency: subaccount.currency,
    ledgerAccountId: subaccount.ledgerAccountId,
    date,
    plan:
      plan.kind === "reverse"
        ? { kind: "reverse", entryId: plan.entryId }
        : plan.kind === "post"
          ? { kind: "post", amount: plan.amount.toDecimalString() }
          : { kind: "correct", entryId: plan.entryId, amount: plan.amount.toDecimalString() },
    before: before && {
      entryId: before.entryId,
      amount: before.amount.toDecimalString(),
      date: before.date,
    },
  };
}

/** The managing hand-off of one change (a new `changeId`), enqueued in this transaction. */
async function handOver(
  deps: Pick<AccountsDeps, "newId">,
  tx: AccountsTx,
  householdId: string,
  change: Omit<ManagedHandOff, "kind" | "changeId">,
): Promise<ManagedHandOff> {
  const handOff: ManagedHandOff = { kind: "managed", changeId: deps.newId(), ...change };
  await tx.enqueueHandOff(householdId, handOff, handOff.changeId);
  return handOff;
}

/**
 * Finishes the journal moves of the account's managing changes not handed over yet (their row is locked by the
 * caller): a change planned next reads the balance they left, so it never moves the same money again.
 */
export async function finishPending(
  deps: Pick<AccountsDeps, "ledger">,
  tx: AccountsTx,
  householdId: string,
  accountId: string,
): Promise<void> {
  for (const pending of await tx.pendingManaged(householdId, accountId))
    await applyMoves(deps.ledger, householdId, pending);
}

/**
 * FIN-01@PoC EC4, FIN-12@PoC FR 7 (code review finding 3, 2026-11-16): another module's change of the account's money
 * that is saved but not in the journal yet (a transaction whose hand-off is still in the transactions queue, ARC-04)
 * is finished by that module first (`PendingPostings`, its port — never its tables), so the movements after the
 * closing date and the balance on it are read as they will be. One that cannot finish now refuses the closing.
 * The route calls it before it opens the accounts transaction: the other module's hand-off reads accounts' directory on
 * this module's own pool, so running it while a connection (and the row lock) is held wedges the pool once as many
 * closings run at once as it has connections.
 */
export async function settlePending(
  deps: Pick<AccountsDeps, "pendingPostings">,
  householdId: string,
  accountId: string,
): Promise<ManageRefusal | null> {
  for (const module of deps.pendingPostings)
    if (!(await module.settle(householdId, accountId))) return { kind: "postings-pending" };
  return null;
}

/** The account's row, locked until the transaction ends; a refusal when it is not there or not active. */
async function activeAccount(
  tx: AccountsTx,
  householdId: string,
  accountId: string,
): Promise<StoredAccount | ManageRefusal> {
  const account = await tx.lockAccount(householdId, accountId);
  if (!account) return { kind: "not-found" };
  if (account.status === "closed") return { kind: "closed" };
  return account;
}

/** The active account's row, locked, with its earlier changes' journal moves finished. */
async function managedAccount(
  deps: Pick<AccountsDeps, "ledger">,
  tx: AccountsTx,
  householdId: string,
  accountId: string,
): Promise<StoredAccount | ManageRefusal> {
  const account = await activeAccount(tx, householdId, accountId);
  if (!refused(account)) await finishPending(deps, tx, householdId, accountId);
  return account;
}

const refused = (a: StoredAccount | ManageRefusal): a is ManageRefusal => !("id" in a);

/** The closing dialog (FIN-12 FR 7, AC4): the balance on the closing date per currency, and whether it is zero. */
export async function closingPreview(
  deps: Pick<AccountsDeps, "ledger" | "today">,
  tx: AccountsTx,
  householdId: string,
  accountId: string,
  closedOn: string,
): Promise<ManageRefusal | { readonly kind: "preview"; readonly currencies: readonly CurrencyBalance[] }> {
  // A read: no row lock (#228). The same refusals as the closing itself, so the dialog never offers a date that the
  // closing would refuse with 409 (a movement after it).
  const account = await tx.account(householdId, accountId);
  if (!account) return { kind: "not-found" };
  if (account.status === "closed") return { kind: "closed" };
  const issue = closingDateIssue(closedOn, account.openedOn, deps.today());
  if (issue) return { kind: "invalid", issues: [{ field: "closedOn", issue }] };
  const currencies = [];
  for (const s of await tx.subaccounts(householdId, accountId)) {
    const latest = await deps.ledger.latestOperationDate(householdId, s.ledgerAccountId);
    if (latest !== null && latest > closedOn) return { kind: "activity-after-close" };
  }
  for (const s of await tx.subaccounts(householdId, accountId))
    currencies.push({
      currency: s.currency,
      balance: await shownOn(deps, householdId, account, s, closedOn),
    });
  return { kind: "preview", currencies };
}

export type Settlement =
  { readonly kind: "transfer"; readonly toAccountId: string } | { readonly kind: "adjustment" };

/**
 * Closing an account (FIN-12 FR 7, FR 8, AC3, AC4): only with a zero balance on the closing date. A balance that is
 * not zero needs the user's choice: «Перенести на інший рахунок» — a transfer of each currency's balance to another
 * active account of the space with that currency (a debt is paid from it), or «Списати коригуванням» — the adjustment
 * brought to zero, dated the closing date. Movements after the closing date refuse that date. Nothing is deleted.
 */
export async function closeAccount(
  deps: AccountsDeps,
  tx: AccountsTx,
  caller: Caller,
  accountId: string,
  input: { readonly closedOn: string; readonly settlement: Settlement | null },
): Promise<ManageRefusal | { readonly kind: "account-closed"; readonly handOff: ManagedHandOff }> {
  const { householdId } = caller;
  const target = input.settlement?.kind === "transfer" ? input.settlement.toAccountId : null;
  // Both rows locked in the order of their ids, so two closings that transfer to each other cannot deadlock.
  if (target !== null && target !== accountId && target < accountId)
    await tx.lockAccount(householdId, target);
  const account = await managedAccount(deps, tx, householdId, accountId);
  if (refused(account)) return account;
  const today = deps.today();
  const issue = closingDateIssue(input.closedOn, account.openedOn, today);
  if (issue) return { kind: "invalid", issues: [{ field: "closedOn", issue }] };

  const subaccounts = await tx.subaccounts(householdId, accountId);
  const owed: { readonly subaccount: StoredSubaccount; readonly balance: Money }[] = [];
  for (const s of subaccounts) {
    // FIN-01 EC4: «Після дати закриття є транзакції» — any entry after the date, even one that nets to zero.
    const latest = await deps.ledger.latestOperationDate(householdId, s.ledgerAccountId);
    if (latest !== null && latest > input.closedOn) return { kind: "activity-after-close" };
    const onDate = await shownOn(deps, householdId, account, s, input.closedOn);
    if (!onDate.isZero()) owed.push({ subaccount: s, balance: onDate });
  }
  if (owed.length > 0 && !input.settlement) return { kind: "balance-not-zero" };

  const moves: HandOffMove[] = [];
  if (owed.length > 0 && input.settlement?.kind === "transfer") {
    const issueOf = (issue: string): ManageRefusal => ({
      kind: "invalid",
      issues: [{ field: "settlement.toAccountId", issue }],
    });
    if (input.settlement.toAccountId === accountId) return issueOf("same_account");
    const other = await tx.lockAccount(householdId, input.settlement.toAccountId);
    if (!other) return issueOf("not_found");
    if (other.status === "closed") return issueOf("closed");
    if (other.openedOn > input.closedOn) return issueOf("opened_later");
    const theirs = await tx.subaccounts(householdId, other.id);
    for (const o of owed) {
      const into = theirs.find((t) => t.currency === o.subaccount.currency);
      if (!into) return issueOf("currency_missing");
      // A positive balance leaves this account; a negative one (a debt, an overdraft) is paid from the other.
      const [from, to] = o.balance.isNegative()
        ? [into.ledgerAccountId, o.subaccount.ledgerAccountId]
        : [o.subaccount.ledgerAccountId, into.ledgerAccountId];
      moves.push({
        op: "transfer",
        subaccountId: o.subaccount.id,
        currency: o.subaccount.currency,
        toAccountId: other.id,
        from,
        to,
        balance: o.balance.toDecimalString(),
        date: input.closedOn,
      });
    }
  } else if (owed.length > 0) {
    for (const { subaccount, balance } of owed) {
      const before = await liveAdjustment(deps, householdId, subaccount);
      const plan = balanceUpdatePlan(balance, Money.zero(subaccount.currency), before);
      const move = adjustMove(subaccount, plan, input.closedOn, before);
      if (move) moves.push(move);
    }
  }

  await tx.setStatus(householdId, accountId, "closed", input.closedOn);
  const status: HandOffStatus = {
    before: { status: account.status, closedOn: account.closedOn },
    after: { status: "closed", closedOn: input.closedOn },
    settlement:
      owed.length > 0 && input.settlement
        ? {
            ...input.settlement,
            amounts: owed.map((o) => ({
              currency: o.subaccount.currency,
              balance: o.balance.toDecimalString(),
            })),
          }
        : null,
  };
  const handOff = await handOver(deps, tx, householdId, {
    accountId,
    actor: actorOf(caller),
    channel: "web",
    moves,
    status,
  });
  return { kind: "account-closed", handOff };
}

/**
 * «Відкрити знову» (FIN-12 FR 9): a closed account is active again; its history is as it was. On purpose it does not
 * finish the journal moves of earlier changes not handed over yet (`finishPending`, #263 item 5): it moves no money and
 * reads no balance, so nothing is planned on a journal that lacks them; the next change of its money finishes them first.
 */
export async function reopenAccount(
  deps: Pick<AccountsDeps, "newId">,
  tx: AccountsTx,
  caller: Caller,
  accountId: string,
): Promise<ManageRefusal | { readonly kind: "reopened"; readonly handOff: ManagedHandOff }> {
  const account = await tx.lockAccount(caller.householdId, accountId);
  if (!account) return { kind: "not-found" };
  if (account.status !== "closed") return { kind: "not-closed" };
  await tx.setStatus(caller.householdId, accountId, "active", null);
  const handOff = await handOver(deps, tx, caller.householdId, {
    accountId,
    actor: actorOf(caller),
    channel: "web",
    moves: [],
    status: {
      before: { status: account.status, closedOn: account.closedOn },
      after: { status: "active", closedOn: null },
      settlement: null,
    },
  });
  return { kind: "reopened", handOff };
}

const actorOf = (caller: Caller): ManageActor => ({ kind: "user", id: caller.accountId });
const permanent = (account: StoredAccount) => account.source === "manual";
const view = (account: StoredAccount, a: LiveAdjustment | null): AdjustmentView | null =>
  a && { ...a, permanent: permanent(account) };

/** A currency's adjustment in effect and balance today, as the journal has them now (after the hand-off). */
export async function balanceNow(
  deps: Pick<AccountsDeps, "ledger" | "today">,
  tx: AccountsTx,
  householdId: string,
  accountId: string,
  currency: string,
): Promise<{ readonly adjustment: AdjustmentView | null; readonly balance: Money } | null> {
  const account = await tx.account(householdId, accountId);
  const subaccount = (await tx.subaccounts(householdId, accountId)).find((s) => s.currency === currency);
  if (!account || !subaccount) return null;
  return {
    adjustment: view(account, await liveAdjustment(deps, householdId, subaccount)),
    balance: await shownOn(deps, householdId, account, subaccount, deps.today()),
  };
}

/**
 * «Оновити залишок» (FIN-12 FR 14, AC13, AC14, AC16; FIN-04 FR 10, FR 11, AC5): the balance entered for one currency
 * of the account, dated today. The adjustment is the difference — or its change, when the currency has one already.
 * `balance` is the balance once the hand-off is done: the one entered.
 */
export async function updateBalance(
  deps: AccountsDeps,
  tx: AccountsTx,
  caller: Caller,
  accountId: string,
  input: { readonly amount: string; readonly currency: string },
): Promise<
  | ManageRefusal
  | {
      readonly kind: "updated";
      readonly changed: boolean;
      readonly handOff: ManagedHandOff | null;
      readonly adjustment: AdjustmentView | null;
      readonly balance: Money;
    }
> {
  const { householdId } = caller;
  const account = await managedAccount(deps, tx, householdId, accountId);
  if (refused(account)) return account;
  const subaccount = (await tx.subaccounts(householdId, accountId)).find(
    (s) => s.currency === input.currency,
  );
  if (!subaccount) return { kind: "invalid", issues: [{ field: "balance.currency", issue: "invalid" }] };
  const target = typedBalance(account.kind, input.amount, input.currency);
  if (!target) return { kind: "invalid", issues: [{ field: "balance.amount", issue: "invalid" }] };
  const today = deps.today();
  const current = await shownOn(deps, householdId, account, subaccount, today);
  const before = await liveAdjustment(deps, householdId, subaccount);
  const plan = balanceUpdatePlan(current, target, before);
  const move = adjustMove(subaccount, plan, today, before);
  if (!move)
    return {
      kind: "updated",
      changed: false,
      handOff: null,
      adjustment: view(account, before),
      balance: current,
    };
  const handOff = await handOver(deps, tx, householdId, {
    accountId,
    actor: actorOf(caller),
    channel: "web",
    moves: [move],
    status: null,
  });
  return { kind: "updated", changed: true, handOff, adjustment: null, balance: target };
}

/**
 * Deleting the adjustment (FIN-04 FR 11, AC7): its reversal brings the previous balance back. Only the adjustment in
 * effect is found by its id; one changed or deleted since is «not found». `balance` is the balance once the hand-off is
 * done.
 */
export async function deleteAdjustment(
  deps: AccountsDeps,
  tx: AccountsTx,
  caller: Caller,
  accountId: string,
  adjustmentId: string,
): Promise<
  | ManageRefusal
  | {
      readonly kind: "deleted";
      readonly handOff: ManagedHandOff;
      readonly currency: string;
      readonly balance: Money;
    }
> {
  const { householdId } = caller;
  const account = await managedAccount(deps, tx, householdId, accountId);
  if (refused(account)) return account;
  for (const s of await tx.subaccounts(householdId, accountId)) {
    const before = await liveAdjustment(deps, householdId, s);
    if (before?.entryId !== adjustmentId) continue;
    const today = deps.today();
    const handOff = await handOver(deps, tx, householdId, {
      accountId,
      actor: actorOf(caller),
      channel: "web",
      moves: [adjustMove(s, { kind: "reverse", entryId: before.entryId }, today, before)!],
      status: null,
    });
    // An adjustment is dated today at the latest, so today's balance loses all of it.
    const balance = (await shownOn(deps, householdId, account, s, today)).minus(before.amount);
    return { kind: "deleted", handOff, currency: s.currency, balance };
  }
  return { kind: "not-found" };
}

export type StatementResult =
  | { readonly kind: "none" | "changed" | "deleted" }
  /** A manual account's adjustment is permanent: a statement does not recount it. */
  | { readonly kind: "permanent" }
  | { readonly kind: "not-found" | "closed" }
  /** The statement's end is not a date, is in the future, or is before the account's opening (#228). */
  | { readonly kind: "bad-date" };

/**
 * The recount of a temporary adjustment by a statement with a closing balance (FIN-12 FR 15, AC15), for the import of
 * statements: the new difference is the bank's balance minus the account's balance without the adjustment on the
 * statement's end; zero removes the adjustment, another amount changes it, dated the statement's end. The system
 * never creates an adjustment by itself (FIN-04 FR 11). Audited as the system's, through the import channel.
 */
export async function reconcileStatement(
  deps: AccountsDeps,
  tx: AccountsTx,
  householdId: string,
  input: { readonly accountId: string; readonly statementEnd: string; readonly closingBalance: Money },
): Promise<{ readonly result: StatementResult; readonly handOff: ManagedHandOff | null }> {
  const account = await managedAccount(deps, tx, householdId, input.accountId);
  const done = (result: StatementResult) => ({ result, handOff: null });
  if (refused(account)) return done(account.kind === "closed" ? { kind: "closed" } : { kind: "not-found" });
  // The caller passes the space of its principal after its own check of rights; the date is checked here (#228).
  if (
    !isCalendarDate(input.statementEnd) ||
    input.statementEnd > deps.today() ||
    input.statementEnd < account.openedOn
  )
    return done({ kind: "bad-date" });
  const subaccount = (await tx.subaccounts(householdId, account.id)).find(
    (s) => s.currency === input.closingBalance.currency,
  );
  if (!subaccount) return done({ kind: "not-found" });
  const before = await liveAdjustment(deps, householdId, subaccount);
  if (before && permanent(account)) return done({ kind: "permanent" });
  const onEnd = await shownOn(deps, householdId, account, subaccount, input.statementEnd);
  const included =
    before && before.date <= input.statementEnd ? before.amount : Money.zero(subaccount.currency);
  const plan = statementPlan(onEnd.minus(included), input.closingBalance, before, input.statementEnd);
  const move = adjustMove(subaccount, plan, input.statementEnd, before);
  if (!move) return done({ kind: "none" });
  const handOff = await handOver(deps, tx, householdId, {
    accountId: account.id,
    actor: { kind: "system" },
    channel: "import",
    moves: [move],
    status: null,
  });
  return { result: { kind: plan.kind === "reverse" ? "deleted" : "changed" }, handOff };
}
