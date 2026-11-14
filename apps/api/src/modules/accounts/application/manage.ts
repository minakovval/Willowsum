import { Money } from "@willowsum/domain-kernel";
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
import { ADJUSTMENT, adjustmentOf, liveAdjustment, type AdjustmentView } from "./adjustments.ts";

/**
 * Managing an account (FIN-12@PoC FR 7–9, FR 14, FR 15; FIN-04@PoC FR 10, FR 11; wave 2 row 13): closing with the
 * balance moved to another account or written off, reopening, «Оновити залишок» and deleting its adjustment, and the
 * recount of a temporary adjustment by a statement. Each runs in the accounts transaction with the account's row
 * locked (two requests on one account run one after the other):
 *
 * 1. the request is checked against the account as it is — nothing is written for a refusal;
 * 2. the money moves in one ledger transaction (a transfer, or the adjustment posted, corrected or reversed): its
 *    postings are written together or not at all (FIN-04 FR 2);
 * 3. the account's state changes (closing, reopening) in this transaction;
 * 4. the audit entry, last before this transaction commits.
 *
 * The ledger and the audit log are other modules' transactions (as in creating an account; ARC-04 hand-over is #210).
 * Every step is safe to repeat: a failure after the ledger committed leaves a movement the user asked for and the
 * account as it was, and the same request again finds the balance already moved and only finishes the rest.
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
  | { readonly kind: "balance-not-zero" };

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

/** Applies an adjustment plan in one ledger transaction; the adjustment in effect afterwards. */
async function applyPlan(
  deps: Pick<AccountsDeps, "ledger" | "newId">,
  householdId: string,
  subaccount: StoredSubaccount,
  plan: AdjustmentPlan,
  date: string,
  before: LiveAdjustment | null,
): Promise<LiveAdjustment | null> {
  const source = { module: "accounts", id: subaccount.id };
  const event = (amount: Money) =>
    ({
      type: ADJUSTMENT,
      account: subaccount.ledgerAccountId,
      amount,
    }) as const;
  switch (plan.kind) {
    case "none":
      return before;
    case "post": {
      const entry = await deps.ledger.post(householdId, {
        source,
        idempotencyKey: `accounts.adjust:${deps.newId()}`,
        operationDate: date,
        event: event(plan.amount),
      });
      return adjustmentOf(entry, subaccount);
    }
    case "correct": {
      const { entry } = await deps.ledger.correct(householdId, plan.entryId, {
        source,
        idempotencyKey: `accounts.adjust:${deps.newId()}`,
        operationDate: date,
        event: event(plan.amount),
      });
      return adjustmentOf(entry, subaccount);
    }
    case "reverse":
      await deps.ledger.reverse(householdId, plan.entryId, `accounts.adjust-delete:${plan.entryId}`);
      return null;
  }
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

const refused = (a: StoredAccount | ManageRefusal): a is ManageRefusal => !("id" in a);

/** The closing dialog (FIN-12 FR 7, AC4): the balance on the closing date per currency, and whether it is zero. */
export async function closingPreview(
  deps: Pick<AccountsDeps, "ledger" | "today">,
  tx: AccountsTx,
  householdId: string,
  accountId: string,
  closedOn: string,
): Promise<ManageRefusal | { readonly kind: "preview"; readonly currencies: readonly CurrencyBalance[] }> {
  const account = await activeAccount(tx, householdId, accountId);
  if (refused(account)) return account;
  const issue = closingDateIssue(closedOn, account.openedOn, deps.today());
  if (issue) return { kind: "invalid", issues: [{ field: "closedOn", issue }] };
  const currencies = [];
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
): Promise<ManageRefusal | { readonly kind: "account-closed" }> {
  const { householdId } = caller;
  const target = input.settlement?.kind === "transfer" ? input.settlement.toAccountId : null;
  // Both rows locked in the order of their ids, so two closings that transfer to each other cannot deadlock.
  if (target !== null && target !== accountId && target < accountId)
    await tx.lockAccount(householdId, target);
  const account = await activeAccount(tx, householdId, accountId);
  if (refused(account)) return account;
  const today = deps.today();
  const issue = closingDateIssue(input.closedOn, account.openedOn, today);
  if (issue) return { kind: "invalid", issues: [{ field: "closedOn", issue }] };

  const subaccounts = await tx.subaccounts(householdId, accountId);
  const owed: { readonly subaccount: StoredSubaccount; readonly balance: Money }[] = [];
  for (const s of subaccounts) {
    const onDate = await shownOn(deps, householdId, account, s, input.closedOn);
    const now = await shownOn(deps, householdId, account, s, today);
    if (!onDate.equals(now)) return { kind: "activity-after-close" };
    if (!onDate.isZero()) owed.push({ subaccount: s, balance: onDate });
  }
  if (owed.length > 0 && !input.settlement) return { kind: "balance-not-zero" };

  const settled: CurrencyBalance[] = [];
  if (owed.length > 0 && input.settlement?.kind === "transfer") {
    const issueOf = (issue: string): ManageRefusal => ({
      kind: "invalid",
      issues: [{ field: "settlement.toAccountId", issue }],
    });
    if (input.settlement.toAccountId === accountId) return issueOf("same_account");
    const other = await tx.lockAccount(householdId, input.settlement.toAccountId);
    if (!other) return issueOf("not_found");
    if (other.status === "closed") return issueOf("closed");
    const theirs = await tx.subaccounts(householdId, other.id);
    const plans = [];
    for (const o of owed) {
      const into = theirs.find((t) => t.currency === o.subaccount.currency);
      if (!into) return issueOf("currency_missing");
      plans.push({ ...o, into });
    }
    for (const { subaccount, into, balance } of plans) {
      // A positive balance leaves this account; a negative one (a debt, an overdraft) is paid from the other.
      const [from, to] = balance.isNegative()
        ? [into.ledgerAccountId, subaccount.ledgerAccountId]
        : [subaccount.ledgerAccountId, into.ledgerAccountId];
      await deps.ledger.post(householdId, {
        source: { module: "accounts", id: subaccount.id },
        idempotencyKey: `accounts.close:${deps.newId()}`,
        operationDate: input.closedOn,
        event: { type: "transfer", from, to, amount: balance.isNegative() ? balance.negated() : balance },
      });
      settled.push({ currency: subaccount.currency, balance });
    }
  } else if (owed.length > 0) {
    for (const { subaccount, balance } of owed) {
      const before = await liveAdjustment(deps, householdId, subaccount);
      const plan = balanceUpdatePlan(balance, Money.zero(subaccount.currency), before);
      const after = await applyPlan(deps, householdId, subaccount, plan, input.closedOn, before);
      await deps.audit.adjustmentChanged(householdId, actorOf(caller), "web", subaccount, before, after);
      settled.push({ currency: subaccount.currency, balance });
    }
  }

  await tx.setStatus(householdId, accountId, "closed", input.closedOn);
  await deps.audit.statusChanged(householdId, caller.accountId, account, {
    status: "closed",
    closedOn: input.closedOn,
    settlement: owed.length > 0 && input.settlement ? { ...input.settlement, amounts: settled } : null,
  });
  return { kind: "account-closed" };
}

/** «Відкрити знову» (FIN-12 FR 9): a closed account is active again; its history is as it was. */
export async function reopenAccount(
  deps: Pick<AccountsDeps, "audit">,
  tx: AccountsTx,
  caller: Caller,
  accountId: string,
): Promise<ManageRefusal | { readonly kind: "reopened" }> {
  const account = await tx.lockAccount(caller.householdId, accountId);
  if (!account) return { kind: "not-found" };
  if (account.status !== "closed") return { kind: "not-closed" };
  await tx.setStatus(caller.householdId, accountId, "active", null);
  await deps.audit.statusChanged(caller.householdId, caller.accountId, account, {
    status: "active",
    closedOn: null,
    settlement: null,
  });
  return { kind: "reopened" };
}

const actorOf = (caller: Caller) => ({ kind: "user", id: caller.accountId }) as const;
const permanent = (account: StoredAccount) => account.source === "manual";
const view = (account: StoredAccount, a: LiveAdjustment | null): AdjustmentView | null =>
  a && { ...a, permanent: permanent(account) };

/**
 * «Оновити залишок» (FIN-12 FR 14, AC13, AC14, AC16; FIN-04 FR 10, FR 11, AC5): the balance entered for one currency
 * of the account, dated today. The adjustment is the difference — or its change, when the currency has one already.
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
      readonly adjustment: AdjustmentView | null;
      readonly balance: Money;
    }
> {
  const { householdId } = caller;
  const account = await activeAccount(tx, householdId, accountId);
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
  const after = await applyPlan(deps, householdId, subaccount, plan, today, before);
  if (plan.kind !== "none")
    await deps.audit.adjustmentChanged(householdId, actorOf(caller), "web", subaccount, before, after);
  return {
    kind: "updated",
    changed: plan.kind !== "none",
    adjustment: view(account, after),
    balance: await shownOn(deps, householdId, account, subaccount, today),
  };
}

/**
 * Deleting the adjustment (FIN-04 FR 11, AC7): its reversal brings the previous balance back. Only the adjustment in
 * effect is found by its id; one changed or deleted since is «not found».
 */
export async function deleteAdjustment(
  deps: AccountsDeps,
  tx: AccountsTx,
  caller: Caller,
  accountId: string,
  adjustmentId: string,
): Promise<ManageRefusal | { readonly kind: "deleted"; readonly balance: Money }> {
  const { householdId } = caller;
  const account = await activeAccount(tx, householdId, accountId);
  if (refused(account)) return account;
  for (const s of await tx.subaccounts(householdId, accountId)) {
    const before = await liveAdjustment(deps, householdId, s);
    if (before?.entryId !== adjustmentId) continue;
    await deps.ledger.reverse(householdId, before.entryId, `accounts.adjust-delete:${before.entryId}`);
    await deps.audit.adjustmentChanged(householdId, actorOf(caller), "web", s, before, null);
    return { kind: "deleted", balance: await shownOn(deps, householdId, account, s, deps.today()) };
  }
  return { kind: "not-found" };
}

export type StatementResult =
  | { readonly kind: "none" | "changed" | "deleted" }
  /** A manual account's adjustment is permanent: a statement does not recount it. */
  | { readonly kind: "permanent" }
  | { readonly kind: "not-found" | "closed" };

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
): Promise<StatementResult> {
  const account = await activeAccount(tx, householdId, input.accountId);
  if (refused(account)) return account.kind === "closed" ? { kind: "closed" } : { kind: "not-found" };
  const subaccount = (await tx.subaccounts(householdId, account.id)).find(
    (s) => s.currency === input.closingBalance.currency,
  );
  if (!subaccount) return { kind: "not-found" };
  const before = await liveAdjustment(deps, householdId, subaccount);
  if (before && permanent(account)) return { kind: "permanent" };
  const onEnd = await shownOn(deps, householdId, account, subaccount, input.statementEnd);
  const included =
    before && before.date <= input.statementEnd ? before.amount : Money.zero(subaccount.currency);
  const plan = statementPlan(onEnd.minus(included), input.closingBalance, before, input.statementEnd);
  const after = await applyPlan(deps, householdId, subaccount, plan, input.statementEnd, before);
  if (plan.kind === "none") return { kind: "none" };
  await deps.audit.adjustmentChanged(householdId, { kind: "system" }, "import", subaccount, before, after);
  return { kind: plan.kind === "reverse" ? "deleted" : "changed" };
}
