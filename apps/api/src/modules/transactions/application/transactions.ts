import type { Money } from "@willowsum/domain-kernel";
import {
  checkDate,
  counterpartyText,
  descriptionText,
  parseSignedAmount,
  subaccountFor,
  type FieldIssue,
  type PostingAccount,
  type TransactionStatus,
  type TransferLink,
} from "../domain/index.ts";
import { transactionAuditValues, type HandOffDeps, type TransactionHandOff } from "./hand-off.ts";
import type { NewStoredTransaction, StoredTransaction } from "./stored.ts";

/**
 * Transactions entered by hand (FIN-03@PoC FR 1–3, FR 16, FR 20, FR 29, edge case 2; wave 2 row 15): create, change
 * and delete, each through the journal. A transaction is one `transaction` event of the ledger (source `transactions`
 * / its id): created by `post`, changed by `correct` (a reversal and the new entry in one journal transaction), deleted
 * by `reverse`.
 *
 * Order of one change, in this module's transaction with the row locked: checks → the row → the hand-off job (ARC-04
 * FR 2, hand-off.ts) → commit. The journal and the audit entry (П-10) follow only after the commit (the route right
 * away, the worker if that fails): a failure anywhere before the commit leaves nothing in another module.
 */

export type { NewStoredTransaction, StoredTransaction } from "./stored.ts";

export interface TransactionsTx {
  insert(householdId: string, row: NewStoredTransaction): Promise<StoredTransaction>;
  find(householdId: string, id: string): Promise<StoredTransaction | null>;
  /** The row, locked until the transaction ends: one change of a transaction at a time. */
  lock(householdId: string, id: string): Promise<StoredTransaction | null>;
  update(householdId: string, row: NewStoredTransaction): Promise<StoredTransaction>;
  remove(householdId: string, id: string): Promise<void>;
  /** FIN-03 FR 7: the pair of a transfer, written before its two rows point at it. */
  insertTransfer(householdId: string, link: TransferLink): Promise<void>;
  /** FR 9: the pair removed, once neither row points at it. */
  removeTransfer(householdId: string, id: string): Promise<void>;
  /** FIN-03 FR 11: the transactions merged into `id` as its duplicates, in the order of their ids. */
  duplicatesOf(householdId: string, id: string): Promise<string[]>;
  /** «Не дубль» (FR 12): the pair stored in the order of its ids; false — it was stored already. */
  insertDismissal(householdId: string, firstId: string, secondId: string): Promise<boolean>;
  /**
   * FR 18: the possible duplicates `id` is a side of now, by the search of `DuplicateCandidates` within `windowDays`;
   * first takes the space's lock of hiding on the account until the transaction ends, so two copies are never hidden
   * at once.
   */
  duplicatesForHiding(
    householdId: string,
    id: string,
    accountId: string,
    windowDays: number,
  ): Promise<readonly DuplicatePairSides[]>;
  /** ARC-04 FR 2: the hand-off of this change to the journal and the audit log, enqueued in this transaction. */
  enqueueHandOff(householdId: string, handOff: TransactionHandOff): Promise<void>;
}

export interface TransactionsDeps extends HandOffDeps {
  /** The accounts module's public `AccountDirectory`: the account's state and its subaccounts with their journal accounts. */
  readonly accounts: HandOffDeps["accounts"];
  readonly newId: () => string;
  /** Today's date (YYYY-MM-DD) for «Дата» (FR 29); from the clock, never read here. */
  readonly today: () => string;
  /** The release flag `transactions.states` for the space: «Очікує» and hiding (FIN-03 b); off — «Проведена» only. */
  readonly statesEnabled: (householdId: string) => Promise<boolean>;
  /**
   * FR 18: whether the transaction is a «Можливий дубль» now (module duplicate-matching's rule: another shown transaction
   * on its account with the same amount and currency within 3 days, the pair not «Не дубль»); null when not wired —
   * hiding then answers 500.
   */
  readonly duplicates: DuplicateCheck | null;
}

/** One side of a possible duplicate as the search finds it (FIN-03 FR 12). */
export interface DuplicateSideFound {
  readonly transactionId: string;
  readonly accountId: string;
  readonly amount: Money;
  readonly date: string;
}

export interface DuplicatePairSides {
  readonly first: DuplicateSideFound;
  readonly second: DuplicateSideFound;
}

/** Module duplicate-matching's rule (wired in src/main.ts), pure: the window of the search and the decision. */
export interface DuplicateCheck {
  readonly windowDays: number;
  /** Whether any of the pairs the search found is a «Можливий дубль». */
  isPossibleDuplicate(pairs: readonly DuplicatePairSides[]): boolean;
}

export interface Caller {
  readonly householdId: string;
  /** The member's account (identity); in this release always the space's Owner. */
  readonly accountId: string;
}

export interface TransactionInput {
  readonly accountId: string;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly date: string;
  readonly counterparty?: string | null | undefined;
  readonly description?: string | null | undefined;
  /** «Статус» (FR 28): «Проведена» by default, or «Очікує» (FR 24). */
  readonly status?: TransactionStatus | undefined;
}

/** The fields of the edit form that were sent; absent ones keep their value. */
export type TransactionChange = { readonly [K in keyof TransactionInput]?: TransactionInput[K] | undefined };

export type TransactionResult =
  | {
      readonly kind: "ok";
      readonly transaction: StoredTransaction;
      /** Run it once the transaction has committed (ARC-04 FR 2); the worker runs it too. Null: nothing changed. */
      readonly handOff: TransactionHandOff | null;
    }
  | { readonly kind: "invalid"; readonly issues: readonly FieldIssue[] }
  /** The account is «Закритий»: read only (FIN-12 FR 8). */
  | { readonly kind: "closed" }
  /**
   * A side of a transfer (FR 7, FR 18): never hidden, split or deleted, and its account, amount, date and state stay
   * until the mark is removed (FR 9). Nothing was written.
   */
  | { readonly kind: "in-transfer" }
  /**
   * FR 11, edge case 4: a duplicate merged into another changes only through «Роз'єднати», and a transaction that
   * others were merged into is deleted only once they are unmerged. Nothing was written.
   */
  | { readonly kind: "merged" }
  /** FR 18: hiding is for duplicates and technical records only. Nothing was written. */
  | { readonly kind: "not-hideable" }
  | { readonly kind: "not-found" };

/** The hand-off of one change, with its audit values, enqueued in the caller's transaction. */
async function handOff(
  tx: TransactionsTx,
  caller: Caller,
  action: TransactionHandOff["action"],
  before: StoredTransaction | null,
  after: StoredTransaction | null,
): Promise<TransactionHandOff> {
  const row = (after ?? before)!;
  const h: TransactionHandOff = {
    transactionId: row.id,
    actorAccountId: caller.accountId,
    action,
    version: row.version,
    audit: transactionAuditValues(action, before, after),
  };
  await tx.enqueueHandOff(caller.householdId, h);
  return h;
}

/** Optional texts: absent — `keep`; null or empty — none; else the text, or undefined when invalid. */
function text(
  value: string | null | undefined,
  parse: (t: string) => string | null | undefined,
  keep: string | null,
): string | null | undefined {
  if (value === undefined) return keep;
  if (value === null) return null;
  return parse(value);
}

interface Checked {
  readonly account: PostingAccount;
  readonly subaccount: PostingAccount["subaccounts"][number];
  readonly amount: Money;
  readonly date: string;
  readonly counterparty: string | null;
  readonly description: string | null;
  readonly status: TransactionStatus;
}

/** Every field of the form against its rule, then the account and the currency (FR 2, FR 29, FR 32, edge case 2). */
async function check(
  deps: TransactionsDeps,
  householdId: string,
  input: TransactionInput,
  current: StoredTransaction | null,
): Promise<Checked | { readonly issues: FieldIssue[] } | "closed"> {
  const issues: FieldIssue[] = [];
  const amount = parseSignedAmount(input.amount.amount, input.amount.currency);
  if (typeof amount === "string") issues.push({ field: "amount", issue: amount });
  const dateIssue = checkDate(input.date, deps.today());
  if (dateIssue) issues.push({ field: "date", issue: dateIssue });
  const counterparty = text(input.counterparty, counterpartyText, current?.counterparty ?? null);
  if (counterparty === undefined) issues.push({ field: "counterparty", issue: "invalid" });
  const description = text(input.description, descriptionText, current?.description ?? null);
  if (description === undefined) issues.push({ field: "description", issue: "invalid" });
  const status = input.status ?? current?.status ?? "posted";
  // «Очікує» only behind its flag; a transaction already pending may stay so.
  if (status === "pending" && current?.status !== "pending" && !(await deps.statesEnabled(householdId)))
    issues.push({ field: "status", issue: "invalid" });
  // Another space's account and an unknown one answer the same: the space's accounts only (П-5).
  const account = await deps.accounts.postingAccount(householdId, input.accountId);
  if (!account) issues.push({ field: "accountId", issue: "not_found" });
  const subaccount = account && typeof amount !== "string" ? subaccountFor(account, amount.currency) : null;
  if (subaccount === "currency_mismatch")
    issues.push({ field: "amount.currency", issue: "currency_mismatch" });
  if (
    issues.length > 0 ||
    !account ||
    typeof amount === "string" ||
    !subaccount ||
    subaccount === "currency_mismatch"
  )
    return { issues };
  if (account.status === "closed") return "closed";
  return {
    account,
    subaccount,
    amount,
    date: input.date,
    counterparty: counterparty!,
    description: description!,
    status,
  };
}

/**
 * «Додати транзакцію» (FR 1–3): one journal event, the balance recounted at once (the balance is the journal's); with
 * «Статус: Очікує» no event until it is posted (FR 4, FR 24).
 */
export async function createTransaction(
  deps: TransactionsDeps,
  tx: TransactionsTx,
  caller: Caller,
  input: TransactionInput,
): Promise<TransactionResult> {
  const checked = await check(deps, caller.householdId, input, null);
  if (checked === "closed") return { kind: "closed" };
  if ("issues" in checked) return { kind: "invalid", issues: checked.issues };
  const id = deps.newId();
  const row = await tx.insert(caller.householdId, {
    id,
    accountId: checked.account.accountId,
    subaccountId: checked.subaccount.subaccountId,
    amount: checked.amount,
    date: checked.date,
    counterparty: checked.counterparty,
    description: checked.description,
    status: checked.status,
    source: "manual",
    hidden: false,
    split: null,
    transfer: null,
    mergedInto: null,
    version: 1,
  });
  return { kind: "ok", transaction: row, handOff: await handOff(tx, caller, "create", null, row) };
}

/**
 * The edit form's «Зберегти»: the texts change only the row; the account, amount or date change the journal event
 * (`correct`). The account the transaction is on and the one it moves to must both be active.
 */
export async function updateTransaction(
  deps: TransactionsDeps,
  tx: TransactionsTx,
  caller: Caller,
  id: string,
  change: TransactionChange,
): Promise<TransactionResult> {
  const householdId = caller.householdId;
  const current = await tx.lock(householdId, id);
  if (!current) return { kind: "not-found" };
  if (current.mergedInto !== null) return { kind: "merged" };
  const holder = await deps.accounts.postingAccount(householdId, current.accountId);
  if (holder?.status === "closed") return { kind: "closed" };
  const checked = await check(
    deps,
    householdId,
    {
      accountId: change.accountId ?? current.accountId,
      amount: change.amount ?? {
        amount: current.amount.toDecimalString(),
        currency: current.amount.currency,
      },
      date: change.date ?? current.date,
      counterparty: change.counterparty,
      description: change.description,
      status: change.status,
    },
    current,
  );
  if (checked === "closed") return { kind: "closed" };
  if ("issues" in checked) return { kind: "invalid", issues: checked.issues };
  const moneyChanged =
    checked.subaccount.subaccountId !== current.subaccountId ||
    !checked.amount.equals(current.amount) ||
    checked.date !== current.date;
  const textsChanged =
    checked.counterparty !== current.counterparty || checked.description !== current.description;
  const statusChanged = checked.status !== current.status;
  if (!moneyChanged && !textsChanged && !statusChanged)
    return { kind: "ok", transaction: current, handOff: null };
  // The texts of a transfer's side may change; its money and state only once the mark is removed (FR 9).
  if (current.transfer && (moneyChanged || statusChanged)) return { kind: "in-transfer" };
  // BUD-01 FR 6: a split outlives a change of the amount, marked «потребує перегляду».
  const split =
    current.split && !checked.amount.equals(current.amount)
      ? { ...current.split, needsReview: true }
      : current.split;
  const next = await tx.update(householdId, {
    id,
    accountId: checked.account.accountId,
    subaccountId: checked.subaccount.subaccountId,
    amount: checked.amount,
    date: checked.date,
    counterparty: checked.counterparty,
    description: checked.description,
    status: checked.status,
    source: current.source,
    hidden: current.hidden,
    split,
    transfer: current.transfer,
    mergedInto: current.mergedInto,
    version: current.version + 1,
  });
  return { kind: "ok", transaction: next, handOff: await handOff(tx, caller, "update", current, next) };
}

/** «Видалити» of a transaction entered by hand (FR 16, AC10): its postings are reversed, the row goes. */
export async function deleteTransaction(
  deps: TransactionsDeps,
  tx: TransactionsTx,
  caller: Caller,
  id: string,
): Promise<
  | { readonly kind: "ok"; readonly handOff: TransactionHandOff }
  | { readonly kind: "closed" }
  | { readonly kind: "in-transfer" }
  | { readonly kind: "merged" }
  | { readonly kind: "not-found" }
> {
  const householdId = caller.householdId;
  const current = await tx.lock(householdId, id);
  if (!current) return { kind: "not-found" };
  const holder = await deps.accounts.postingAccount(householdId, current.accountId);
  if (holder?.status === "closed") return { kind: "closed" };
  // A side of a transfer is deleted only once the mark is removed (FR 9), so the other side is never left half a pair.
  if (current.transfer) return { kind: "in-transfer" };
  // A duplicate merged into another, or one others were merged into: «Роз'єднати» first, so none is lost (FR 11).
  if (current.mergedInto !== null || (await tx.duplicatesOf(householdId, id)).length > 0)
    return { kind: "merged" };
  await tx.remove(householdId, id);
  return { kind: "ok", handOff: await handOff(tx, caller, "delete", current, null) };
}

/**
 * «Приховати транзакцію» and showing it again (FIN-03 FR 16–18, FR 27): out of the list (unless asked for), the budget
 * and the reports; a manual row's journal entry is reversed on hiding and posted again on showing (FIN-03 FR 17; an imported row keeps its entry). Hiding twice changes nothing. FR 18: only a
 * duplicate is hidden — a «Можливий дубль» now by module duplicate-matching's rule, read under the account's lock of
 * hiding (so of two copies only one is ever hidden); technical records come with bank connections, none is in this
 * release. A transfer between own accounts is never hidden. Without the rule wired, hiding throws (500).
 */
export async function setHidden(
  deps: TransactionsDeps,
  tx: TransactionsTx,
  caller: Caller,
  id: string,
  hidden: boolean,
): Promise<TransactionResult> {
  return changeRow(deps, tx, caller, id, hidden ? "hide" : "show", async (current) => {
    if (current.hidden === hidden) return null;
    if (hidden && current.transfer) return "in-transfer";
    if (hidden) {
      const rule = deps.duplicates;
      if (rule === null) throw new Error("the duplicate rule is not wired");
      const pairs = await tx.duplicatesForHiding(caller.householdId, id, current.accountId, rule.windowDays);
      if (!rule.isPossibleDuplicate(pairs)) return "not-hideable";
    }
    return { ...current, hidden };
  });
}

/**
 * One change of a row that does not change its amount or account (hiding, a split; hiding a manual row reverses its journal entry at the hand-off): under the row's lock, refused on a closed
 * account (FIN-12 FR 8), with its hand-off — the audit entry; `next` null: nothing to change.
 */
export async function changeRow(
  deps: TransactionsDeps,
  tx: TransactionsTx,
  caller: Caller,
  id: string,
  action: TransactionHandOff["action"],
  next: (
    current: StoredTransaction,
  ) =>
    | StoredTransaction
    | FieldIssue[]
    | "in-transfer"
    | "not-hideable"
    | null
    | Promise<StoredTransaction | "in-transfer" | "not-hideable" | null>,
): Promise<TransactionResult> {
  const current = await tx.lock(caller.householdId, id);
  if (!current) return { kind: "not-found" };
  // A merged duplicate is hidden, split or shown only through «Роз'єднати» (FR 11).
  if (current.mergedInto !== null) return { kind: "merged" };
  const holder = await deps.accounts.postingAccount(caller.householdId, current.accountId);
  if (holder?.status === "closed") return { kind: "closed" };
  const changed = await next(current);
  if (changed === "in-transfer") return { kind: "in-transfer" };
  if (changed === "not-hideable") return { kind: "not-hideable" };
  if (Array.isArray(changed)) return { kind: "invalid", issues: changed };
  if (changed === null) return { kind: "ok", transaction: current, handOff: null };
  const row = await tx.update(caller.householdId, { ...changed, version: current.version + 1 });
  return { kind: "ok", transaction: row, handOff: await handOff(tx, caller, action, current, row) };
}
