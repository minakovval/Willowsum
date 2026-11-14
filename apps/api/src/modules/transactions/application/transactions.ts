import type { Money } from "@willowsum/domain-kernel";
import type { Ledger } from "../../ledger/index.ts";
import {
  checkDate,
  counterpartyText,
  descriptionText,
  parseSignedAmount,
  subaccountFor,
  type FieldIssue,
  type PostingAccount,
} from "../domain/index.ts";

/**
 * Transactions entered by hand (FIN-03@PoC FR 1–3, FR 16, FR 20, FR 29, edge case 2; wave 2 row 15): create, change
 * and delete, each through the journal. A transaction is one `transaction` event of the ledger (source `transactions`
 * / its id): created by `post`, changed by `correct` (a reversal and the new entry in one journal transaction), deleted
 * by `reverse`. The entry in effect is always read from the journal (`liveEntries`), never kept here, so a retry
 * after a failure between the journal and this module's commit corrects what the journal holds.
 *
 * Order of one change, in this module's transaction with the row locked: checks → the row → the journal (its own
 * transaction, committed first) → the audit entry (П-10, also committed first) → commit. A failure before the journal
 * leaves nothing; a failure after it leaves the journal and the audit entry of a change the row does not show yet —
 * the same residual risk as the accounts module (#210), closed by the ARC-04 events later.
 */

export const SOURCE_MODULE = "transactions";
const EVENT = "transaction";

export interface StoredTransaction {
  readonly id: string;
  readonly accountId: string;
  readonly subaccountId: string;
  /** Signed, in the account's currency. */
  readonly amount: Money;
  readonly date: string;
  readonly counterparty: string | null;
  readonly description: string | null;
  readonly status: "posted";
  readonly source: "manual";
  readonly version: number;
  /** ISO 8601 UTC; set by the database. */
  readonly createdAt: string;
}

export type NewStoredTransaction = Omit<StoredTransaction, "createdAt">;

export interface TransactionsTx {
  insert(householdId: string, row: NewStoredTransaction): Promise<StoredTransaction>;
  find(householdId: string, id: string): Promise<StoredTransaction | null>;
  /** The row, locked until the transaction ends: one change of a transaction at a time. */
  lock(householdId: string, id: string): Promise<StoredTransaction | null>;
  update(householdId: string, row: NewStoredTransaction): Promise<StoredTransaction>;
  remove(householdId: string, id: string): Promise<void>;
}

/** The space's audit log (FR 20, П-10): every field before and after; texts masked by the log. */
export interface TransactionAudit {
  changed(
    householdId: string,
    actorAccountId: string,
    action: "create" | "update" | "delete",
    before: StoredTransaction | null,
    after: StoredTransaction | null,
  ): Promise<void>;
}

export interface TransactionsDeps {
  /** The accounts module's public `AccountDirectory`: the account's state and its subaccounts with their journal accounts. */
  readonly accounts: {
    postingAccount(householdId: string, accountId: string): Promise<PostingAccount | null>;
  };
  readonly ledger: Pick<Ledger, "post" | "correct" | "reverse" | "liveEntries">;
  readonly audit: TransactionAudit;
  readonly newId: () => string;
  /** Today's date (YYYY-MM-DD) for «Дата» (FR 29); from the clock, never read here. */
  readonly today: () => string;
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
}

/** The fields of the edit form that were sent; absent ones keep their value. */
export type TransactionChange = { readonly [K in keyof TransactionInput]?: TransactionInput[K] | undefined };

export type TransactionResult =
  | { readonly kind: "ok"; readonly transaction: StoredTransaction }
  | { readonly kind: "invalid"; readonly issues: readonly FieldIssue[] }
  /** The account is «Закритий»: read only (FIN-12 FR 8). */
  | { readonly kind: "closed" }
  | { readonly kind: "not-found" };

const source = (id: string) => ({ module: SOURCE_MODULE, id });

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
  };
}

/** «Додати транзакцію» (FR 1–3): one journal event, the balance recounted at once (the balance is the journal's). */
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
    status: "posted",
    source: "manual",
    version: 1,
  });
  await deps.ledger.post(caller.householdId, {
    source: source(id),
    idempotencyKey: `transactions.create:${id}`,
    operationDate: checked.date,
    event: { type: EVENT, account: checked.subaccount.ledgerAccountId, amount: checked.amount },
  });
  await deps.audit.changed(caller.householdId, caller.accountId, "create", null, row);
  return { kind: "ok", transaction: row };
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
  if (!moneyChanged && !textsChanged) return { kind: "ok", transaction: current };
  const next = await tx.update(householdId, {
    id,
    accountId: checked.account.accountId,
    subaccountId: checked.subaccount.subaccountId,
    amount: checked.amount,
    date: checked.date,
    counterparty: checked.counterparty,
    description: checked.description,
    status: current.status,
    source: current.source,
    version: current.version + 1,
  });
  if (moneyChanged) {
    const replacement = {
      source: source(id),
      operationDate: checked.date,
      event: { type: EVENT, account: checked.subaccount.ledgerAccountId, amount: checked.amount },
    } as const;
    const live = await deps.ledger.liveEntries(householdId, source(id), EVENT);
    const inEffect = live.at(-1);
    // Each entry in effect is corrected at most once, so its id makes the key: a retry after a failure that left the
    // journal ahead of this row corrects the entry the journal holds now.
    if (inEffect)
      await deps.ledger.correct(householdId, inEffect.id, {
        ...replacement,
        idempotencyKey: `transactions.edit:${inEffect.id}`,
      });
    else
      await deps.ledger.post(householdId, {
        ...replacement,
        idempotencyKey: `transactions.repost:${id}:${next.version}`,
      });
  }
  await deps.audit.changed(householdId, caller.accountId, "update", current, next);
  return { kind: "ok", transaction: next };
}

/** «Видалити» of a transaction entered by hand (FR 16, AC10): its postings are reversed, the row goes. */
export async function deleteTransaction(
  deps: TransactionsDeps,
  tx: TransactionsTx,
  caller: Caller,
  id: string,
): Promise<{ readonly kind: "ok" } | { readonly kind: "closed" } | { readonly kind: "not-found" }> {
  const householdId = caller.householdId;
  const current = await tx.lock(householdId, id);
  if (!current) return { kind: "not-found" };
  const holder = await deps.accounts.postingAccount(householdId, current.accountId);
  if (holder?.status === "closed") return { kind: "closed" };
  await tx.remove(householdId, id);
  for (const entry of await deps.ledger.liveEntries(householdId, source(id), EVENT))
    await deps.ledger.reverse(householdId, entry.id, `transactions.delete:${entry.id}`);
  await deps.audit.changed(householdId, caller.accountId, "delete", current, null);
  return { kind: "ok" };
}
