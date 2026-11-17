import { Money } from "@willowsum/domain-kernel";
import {
  checkAddedCurrency,
  freePosition,
  ledgerTypeOf,
  openingEventAmount,
  removalIssue,
  type AddedCurrencyInput,
  type FieldIssue,
} from "../domain/index.ts";
import { adjustmentOf } from "./adjustments.ts";
import {
  findDuplicate,
  NUMBER_FIELD,
  type AccountsDeps,
  type AccountsTx,
  type Caller,
  type StoredSubaccount,
} from "./accounts.ts";
import { openSubaccount, type AuditChange, type HandOff, type HandOffSubaccount } from "./hand-off.ts";
import { finishPending } from "./manage.ts";

/**
 * The currencies (wallets) of an existing account (IMP-02@PoC FR 1, FR 13–15, AC13, AC14; FIN-01@PoC FR 12; FIN-12@PoC
 * FR 4; wave 2 row 18): a multi-currency account is a container with a subaccount per currency, the same model for a
 * manual account and an imported one. Accounts have kept their currencies as subaccounts since FIN-01 (one per
 * currency, position 0 the main one), so an existing account already is a container with one wallet in its currency:
 * no data moves (FR 13).
 *
 * «+ додати ще валюту» in «Основне», in the accounts transaction with the account's row locked:
 *
 * 1. the currency is checked against the account as it is (a current account, not one it has, at most 10, the balance
 *    and the date) and the duplicate rule applied (the same institution, number and currency, FIN-01 FR 25);
 * 2. the subaccount with the id of its ledger account, at the first free position;
 * 3. the hand-off job (ARC-04 FR 2, hand-off.ts `currency-changed`): once it has committed, the ledger account and
 *    «Початковий залишок» on its date (none for a zero balance), then the audit entry — right away from the route, and
 *    from the worker if that fails.
 *
 * Removing a currency, in the same way: the main currency stays; a wallet with transactions stays (no entry in effect
 * besides «Початковий залишок»). First the hand-offs of the account not done yet are finished — the wallet's own ledger
 * account and opening balance, and the journal moves of managing — so the check reads the journal they leave. Then the
 * subaccount is deleted and the hand-off reverses its opening balance in the journal (which is only appended to) and
 * writes the audit entry. The wallet's ledger account stays, at zero.
 */

export type CurrencyRefusal =
  | { readonly kind: "not-found" }
  | { readonly kind: "closed" }
  | { readonly kind: "invalid"; readonly issues: readonly FieldIssue[] }
  | { readonly kind: "duplicate" }
  | { readonly kind: "main-currency" }
  | { readonly kind: "has-transactions" };

export type CurrencyResult =
  | CurrencyRefusal
  | { readonly kind: "added"; readonly handOff: HandOff }
  | { readonly kind: "removed"; readonly handOff: HandOff };

/** «Початковий залишок» is the wallet's starting point, not a transaction (FIN-01 FR 7; as in settings.ts). */
const NOT_TRANSACTIONS = ["opening-balance"] as const;

const field = (currency: string, name: string) => `currencies.${currency}.${name}`;

/** «+ додати ще валюту» on an existing account (IMP-02 FR 15, AC14; FIN-01 FR 12, AC4). */
export async function addCurrency(
  deps: Pick<AccountsDeps, "newId" | "seal" | "today">,
  tx: AccountsTx,
  caller: Caller,
  accountId: string,
  input: AddedCurrencyInput,
): Promise<CurrencyRefusal | Extract<CurrencyResult, { kind: "added" }>> {
  const { householdId } = caller;
  const account = await tx.lockAccount(householdId, accountId);
  if (!account) return { kind: "not-found" };
  if (account.status === "closed") return { kind: "closed" };
  const subaccounts = await tx.subaccounts(householdId, accountId);
  const checked = checkAddedCurrency(
    account,
    subaccounts.map((s) => s.currency),
    input,
    deps.today(),
  );
  if ("issues" in checked) return { kind: "invalid", issues: checked.issues };
  const { balance, date } = checked.opening;

  if (account.numberLast4 !== null) {
    // The same lock as a create (FIN-01 FR 25): two requests cannot both pass the duplicate check.
    await tx.lockCreations(householdId);
    const full =
      account.numberSealed === null
        ? null
        : await deps.seal.open(householdId, NUMBER_FIELD, account.numberSealed);
    const duplicate = await findDuplicate(deps, tx, householdId, {
      institutionKey: account.institutionKey,
      number: { last4: account.numberLast4, full },
      currencies: [balance.currency],
      exceptAccountId: accountId,
    });
    if (duplicate) return { kind: "duplicate" };
  }

  const position = freePosition(subaccounts.map((s) => s.position));
  if (position === null) return { kind: "invalid", issues: [{ field: "currency", issue: "too_many" }] };
  const subaccount: StoredSubaccount = {
    id: deps.newId(),
    accountId,
    currency: balance.currency,
    position,
    // The ledger account is opened by the hand-off under this id, after the commit (ARC-04).
    ledgerAccountId: deps.newId(),
    balanceDate: date,
  };
  await tx.insertSubaccount(householdId, subaccount);
  const added: HandOffSubaccount = {
    subaccountId: subaccount.id,
    ledgerAccountId: subaccount.ledgerAccountId,
    ledgerType: ledgerTypeOf(account.kind),
    currency: subaccount.currency,
    opening: balance.isZero() ? null : openingEventAmount(account.kind, balance).toDecimalString(),
    date,
  };
  const changes: AuditChange[] = [
    { field: field(balance.currency, "currency"), before: null, after: balance.currency, sensitive: false },
    {
      field: field(balance.currency, "openingBalance"),
      before: null,
      after: balance.toDecimalString(),
      sensitive: false,
    },
    { field: field(balance.currency, "balanceDate"), before: null, after: date, sensitive: false },
  ];
  const handOff = await handOver(deps, tx, caller, accountId, { added, removed: null, changes });
  return { kind: "added", handOff };
}

/**
 * Whether any of these wallets of the account (its row locked by the caller) has a transaction — the one question of
 * IMP-02 FR 15 (removing a currency) and FIN-12 FR 5 («Кредит» ↔ «Кредитна картка»), #290 item 3. First the
 * account's hand-offs not done yet are finished — the wallets' own ledger accounts and opening balances, and the
 * journal moves of managing (under this row lock, as those changes ran) — so the journal is read as they leave it.
 * Then: an entry in effect besides «Початковий залишок» (an adjustment of «Оновити залишок» is one, FIN-12 FR 14), or a
 * transaction the journal does not hold yet — «Очікує», or a hand-off not run — that a module keeping subaccount ids
 * answers for (`WalletUsage`).
 */
export async function walletsWithTransactions(
  deps: Pick<AccountsDeps, "ledger" | "walletUsage">,
  tx: AccountsTx,
  householdId: string,
  accountId: string,
  wallets: readonly Pick<StoredSubaccount, "id" | "ledgerAccountId">[],
): Promise<boolean> {
  const ids = new Set(wallets.map((w) => w.id));
  for (const pending of await tx.pendingOpenings(householdId, accountId))
    for (const s of pending) if (ids.has(s.subaccountId)) await openSubaccount(deps.ledger, householdId, s);
  await finishPending(deps, tx, householdId, accountId);

  for (const w of wallets)
    if (await deps.ledger.hasLiveEntries(householdId, w.ledgerAccountId, NOT_TRANSACTIONS)) return true;
  for (const usage of deps.walletUsage) if ((await usage.used(householdId, [...ids])).size > 0) return true;
  return false;
}

/** Removing a currency of an account (IMP-02 FR 15, AC14): only one that is not the main one and has no transactions. */
export async function removeCurrency(
  deps: Pick<AccountsDeps, "ledger" | "newId" | "walletUsage">,
  tx: AccountsTx,
  caller: Caller,
  accountId: string,
  currency: string,
): Promise<CurrencyRefusal | Extract<CurrencyResult, { kind: "removed" }>> {
  const { householdId } = caller;
  const account = await tx.lockAccount(householdId, accountId);
  if (!account) return { kind: "not-found" };
  if (account.status === "closed") return { kind: "closed" };
  const subaccount = (await tx.subaccounts(householdId, accountId)).find((s) => s.currency === currency);
  if (!subaccount) return { kind: "not-found" };
  if (subaccount.position === 0) return { kind: "main-currency" };

  const used = await walletsWithTransactions(deps, tx, householdId, accountId, [subaccount]);
  const issue = removalIssue(subaccount.position, used);
  if (issue === "has_transactions") return { kind: "has-transactions" };
  if (issue === "main_currency") return { kind: "main-currency" };

  const [opening] = await deps.ledger.liveEntries(
    householdId,
    { module: "accounts", id: subaccount.id },
    "opening-balance",
  );
  const openingAmount = opening ? adjustmentOf(opening, subaccount).amount : Money.zero(subaccount.currency);
  await tx.deleteSubaccount(householdId, subaccount.id);
  const changes: AuditChange[] = [
    { field: field(currency, "currency"), before: currency, after: null, sensitive: false },
    {
      field: field(currency, "openingBalance"),
      // From the holder's side, as it was entered (a debt positive).
      before: openingEventAmount(account.kind, openingAmount).toDecimalString(),
      after: null,
      sensitive: false,
    },
    { field: field(currency, "balanceDate"), before: subaccount.balanceDate, after: null, sensitive: false },
  ];
  const handOff = await handOver(deps, tx, caller, accountId, {
    added: null,
    removed: { subaccountId: subaccount.id, openingEntryId: opening?.id ?? null },
    changes,
  });
  return { kind: "removed", handOff };
}

async function handOver(
  deps: Pick<AccountsDeps, "newId">,
  tx: AccountsTx,
  caller: Caller,
  accountId: string,
  change: Pick<Extract<HandOff, { kind: "currency-changed" }>, "added" | "removed" | "changes">,
): Promise<HandOff> {
  const handOff: HandOff = {
    kind: "currency-changed",
    accountId,
    actorAccountId: caller.accountId,
    changeId: deps.newId(),
    ...change,
  };
  await tx.enqueueHandOff(caller.householdId, handOff, handOff.changeId);
  return handOff;
}
