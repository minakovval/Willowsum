import type { ExchangeRate, Money } from "@willowsum/domain-kernel";
import {
  orderPair,
  parseSignedAmount,
  reviewOnCreate,
  transferRateRequest,
  creditFitsJournal,
  transferReceived,
  type FieldIssue,
  type TransferLink,
} from "../domain/index.ts";
import { transactionAuditValues, type TransactionHandOff } from "./hand-off.ts";
import {
  check,
  type Caller,
  type Checked,
  type TransactionsDeps,
  type TransactionsTx,
} from "./transactions.ts";
import type { StoredTransaction } from "./stored.ts";

/**
 * Transfers between own accounts (FIN-03@PoC FR 6, FR 7, FR 9, FR 27; wave 2 row 16b): «Позначити як переказ» and
 * «Підтвердити» of a proposal mark two transactions as one transfer; removing the mark makes them income and expense
 * again. Both rows change in one transactions transaction, locked in the order of their ids (so two marks never wait on
 * each other), each with its hand-off (ARC-04): the journal then has the transfer event instead of their own two, and
 * in one currency the fee as the outflow's own event (hand-off.ts).
 */

export interface TransferDeps extends TransactionsDeps {
  /**
   * Official rates (module fx-rates, `rates`): for each request the rate of its date or the nearest earlier one, null
   * when there is none. A transfer in two currencies keeps the rate of its date (FR 8, the journal's `fx-transfer`).
   */
  readonly rates: (
    requests: readonly { readonly from: string; readonly to: string; readonly date: string }[],
  ) => Promise<readonly (ExchangeRate | null)[]>;
}

/** A transactions transaction of the caller's space (the route's `ctx.inHousehold`). */
export type InTransactions = <T>(work: (tx: TransactionsTx) => Promise<T>) => Promise<T>;

export type TransferResult =
  | {
      readonly kind: "ok";
      readonly transaction: StoredTransaction;
      /** Run them in order once the transaction has committed; the worker runs them too. Empty: nothing changed. */
      readonly handOffs: readonly TransactionHandOff[];
    }
  | { readonly kind: "invalid"; readonly issues: readonly FieldIssue[] }
  | { readonly kind: "closed" }
  | { readonly kind: "not-found" }
  /** A side changed between reading the rate and the change: nothing written, try again. */
  | { readonly kind: "conflict" };

/** Both rows locked in the order of their ids; null where there is none. */
export async function lockBoth(
  tx: TransactionsTx,
  householdId: string,
  a: string,
  b: string,
): Promise<[StoredTransaction | null, StoredTransaction | null]> {
  if (a < b) {
    const first = await tx.lock(householdId, a);
    return [first, await tx.lock(householdId, b)];
  }
  const second = await tx.lock(householdId, b);
  return [await tx.lock(householdId, a), second];
}

/**
 * Whether an account of `rows` is closed now — read under the accounts' money locks (row 198), taken here for all of
 * them at once after the rows' own locks, so a closing never commits between this read and the change's commit.
 */
export async function anyClosed(
  deps: Pick<TransactionsDeps, "accounts">,
  tx: TransactionsTx,
  householdId: string,
  rows: readonly Pick<StoredTransaction, "accountId">[],
) {
  const ids = rows.map((r) => r.accountId);
  await tx.lockAccounts(householdId, ids);
  for (const id of new Set(ids)) {
    const account = await deps.accounts.postingAccount(householdId, id);
    if (account?.status === "closed") return true;
  }
  return false;
}

async function changeBoth(
  tx: TransactionsTx,
  caller: Caller,
  action: "transfer" | "untransfer",
  transferId: string,
  pairs: readonly (readonly [StoredTransaction, StoredTransaction["transfer"]])[],
): Promise<{ rows: StoredTransaction[]; handOffs: TransactionHandOff[] }> {
  const rows: StoredTransaction[] = [];
  const handOffs: TransactionHandOff[] = [];
  for (const [current, transfer] of pairs) {
    const row = await tx.update(caller.householdId, { ...current, transfer, version: current.version + 1 });
    const handOff: TransactionHandOff = {
      transactionId: row.id,
      actorAccountId: caller.accountId,
      action,
      version: row.version,
      transferId,
      audit: transactionAuditValues(action, current, row),
    };
    await tx.enqueueHandOff(caller.householdId, handOff);
    rows.push(row);
    handOffs.push(handOff);
  }
  return { rows, handOffs };
}

/**
 * «Позначити як переказ» (FR 27) and «Підтвердити» (FR 6) on `id` with `counterpartId`: both of the space, posted,
 * shown, not split, in no transfer, on two active accounts, one a debit and the other a credit (domain orderPair). In
 * two currencies the official rate of the transfer's date is read first, outside the transactions transaction.
 */
export async function markTransfer(
  deps: TransferDeps,
  inTransactions: InTransactions,
  caller: Caller,
  id: string,
  counterpartId: string,
): Promise<TransferResult> {
  const householdId = caller.householdId;
  const read = await inTransactions(async (tx) => [
    await tx.find(householdId, id),
    await tx.find(householdId, counterpartId),
  ]);
  const [first, second] = read;
  if (!first) return { kind: "not-found" };
  // Another space's transaction and an unknown one answer the same (П-5).
  if (!second) return { kind: "invalid", issues: [{ field: "counterpartId", issue: "not_found" }] };
  const ordered = orderPair(first, second);
  if (Array.isArray(ordered)) return { kind: "invalid", issues: ordered };
  const request = transferRateRequest(ordered.outflow, ordered.inflow);
  const rate = request === null ? null : ((await deps.rates([request]))[0] ?? null);
  if (request !== null && rate === null)
    return { kind: "invalid", issues: [{ field: "counterpartId", issue: "rate_unavailable" }] };
  return inTransactions(async (tx) => {
    const [current, counterpart] = await lockBoth(tx, householdId, id, counterpartId);
    if (!current) return { kind: "not-found" };
    if (!counterpart) return { kind: "invalid", issues: [{ field: "counterpartId", issue: "not_found" }] };
    const pair = orderPair(current, counterpart);
    if (Array.isArray(pair)) return { kind: "invalid", issues: pair };
    const now = transferRateRequest(pair.outflow, pair.inflow);
    if (JSON.stringify(now) !== JSON.stringify(request)) return { kind: "conflict" };
    // The journal keeps the credit converted into the debit's currency at the kept rate (fx-transfer, ARC-11): a
    // credit whose converted value is beyond a stored amount could never be posted, and the rows' own events would be
    // reversed without it (#461). A field issue on the side that carries it, before the account's state (fields
    // first, then closed: decision 2026-11-16-fin03-transfer-create); nothing written.
    if (now !== null && !creditFitsJournal(pair.inflow.amount, rate!, now.date))
      return {
        kind: "invalid",
        issues: [{ field: pair.inflow.id === id ? "transactionId" : "counterpartId", issue: "invalid" }],
      };
    if (await anyClosed(deps, tx, householdId, [pair.outflow, pair.inflow])) return { kind: "closed" };
    const link: TransferLink = {
      id: deps.newId(),
      outflowId: pair.outflow.id,
      inflowId: pair.inflow.id,
      rate,
    };
    await tx.insertTransfer(householdId, link);
    // The inflow first: its own event goes before the outflow's turns into the fee and the transfer (hand-off.ts).
    const { rows, handOffs } = await changeBoth(tx, caller, "transfer", link.id, [
      [pair.inflow, link],
      [pair.outflow, link],
    ]);
    return { kind: "ok", transaction: rows.find((r) => r.id === id)!, handOffs };
  });
}

/** FR 9: the mark removed — both transactions are income and expense again; without a mark nothing changes. */
export async function unmarkTransfer(
  deps: TransactionsDeps,
  inTransactions: InTransactions,
  caller: Caller,
  id: string,
): Promise<TransferResult> {
  const householdId = caller.householdId;
  return inTransactions(async (tx) => {
    const seen = await tx.find(householdId, id);
    if (!seen) return { kind: "not-found" };
    if (seen.transfer === null) return { kind: "ok", transaction: seen, handOffs: [] };
    const link = seen.transfer;
    const otherId = link.outflowId === id ? link.inflowId : link.outflowId;
    const [current, counterpart] = await lockBoth(tx, householdId, id, otherId);
    if (!current) return { kind: "not-found" };
    // Removed or changed by another request meanwhile: as it is now.
    if (current.transfer?.id !== link.id || counterpart?.transfer?.id !== link.id)
      return { kind: "conflict" };
    if (await anyClosed(deps, tx, householdId, [current, counterpart])) return { kind: "closed" };
    const [outflow, inflow] = current.id === link.outflowId ? [current, counterpart] : [counterpart, current];
    // The outflow first: the transfer event is reversed before the inflow's own event comes back (hand-off.ts).
    const { rows, handOffs } = await changeBoth(tx, caller, "untransfer", link.id, [
      [outflow, null],
      [inflow, null],
    ]);
    await tx.removeTransfer(householdId, link.id);
    return { kind: "ok", transaction: rows.find((r) => r.id === id)!, handOffs };
  });
}

/** «Переказ між рахунками» of the form «Нова транзакція» (FIN-03@PoC FR 1, FR 28; issue #437). */
export interface NewTransferInput {
  /** The account the money leaves («Рахунок*»). */
  readonly fromAccountId: string;
  /** The account it reaches: another account of the space. */
  readonly toAccountId: string;
  /** «Сума*»: positive, in the currency of `fromAccountId` (its subaccount's on a multi-currency account). */
  readonly amount: { readonly amount: string; readonly currency: string };
  /**
   * What reaches `toAccountId`, positive, in its currency: optional — in one currency the amount itself, in two the
   * amount at the official rate of the date (domain transferReceived).
   */
  readonly received?: { readonly amount: string; readonly currency: string } | undefined;
  readonly date: string;
  readonly counterparty?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export type NewTransferResult =
  | {
      readonly kind: "ok";
      readonly outflow: StoredTransaction;
      readonly inflow: StoredTransaction;
      /** Run them in order once the transaction has committed; the worker runs them too. */
      readonly handOffs: readonly TransactionHandOff[];
    }
  | { readonly kind: "invalid"; readonly issues: readonly FieldIssue[] }
  | { readonly kind: "closed" }
  /** Either account unknown or of another space (П-5, FIN-03 AC11): «не знайдено», the same for both. */
  | { readonly kind: "not-found" };

/** The issues of one side's check under the names of the transfer's fields. */
function renamed(issues: readonly FieldIssue[], names: Record<string, string>): FieldIssue[] {
  return issues.map((i) => ({ ...i, field: names[i.field] ?? i.field }));
}

/** A positive amount with the currency's minor units: the issue otherwise. */
function positive(input: { amount: string; currency: string }, field: string): Money | FieldIssue {
  const amount = parseSignedAmount(input.amount, input.currency);
  if (typeof amount === "string") return { field, issue: amount };
  if (amount.isNegative()) return { field, issue: "sign" };
  return amount;
}

const isIssue = (v: unknown): v is FieldIssue =>
  typeof v === "object" && v !== null && "issue" in v && "field" in v;

/**
 * «Переказ між рахунками» in one action (FIN-03@PoC FR 1, FR 28; FR 7, FR 8; issue #437): the debit on `fromAccountId`
 * and the credit on `toAccountId`, both «Проведена», created as one transfer — in one transactions transaction both
 * rows, their pair and their two hand-offs, or nothing. The journal then has one `transfer` (one currency) or
 * `fx-transfer` (two currencies, at the official rate of the date, through «Валютна різниця») event for both legs,
 * and in one currency the fee as the debit's own event (hand-off.ts) — never one leg without the other. Both accounts
 * of the caller's space (else «не знайдено») and active (else «closed»). The rates are read first, outside the
 * transaction; the rows are new, so nothing they depend on changes meanwhile.
 */
export async function createTransfer(
  deps: TransferDeps,
  inTransactions: InTransactions,
  caller: Caller,
  input: NewTransferInput,
): Promise<NewTransferResult> {
  const householdId = caller.householdId;
  const issues: FieldIssue[] = [];
  const sent = positive(input.amount, "amount");
  if (isIssue(sent)) issues.push(sent);
  const given = input.received === undefined ? null : positive(input.received, "received");
  if (isIssue(given)) issues.push(given);
  if (input.fromAccountId === input.toAccountId) issues.push({ field: "toAccountId", issue: "same_account" });
  // Another space's account and an unknown one answer the same: «не знайдено» (П-5, AC11).
  const [from, to] = await Promise.all([
    deps.accounts.postingAccount(householdId, input.fromAccountId),
    deps.accounts.postingAccount(householdId, input.toAccountId),
  ]);
  if (!from || !to) return { kind: "not-found" };
  // The debit: the form's checks of one transaction (date, texts, account, currency) on the negated amount.
  const outflow =
    isIssue(sent) || issues.length > 0
      ? null
      : await check(
          deps,
          householdId,
          { ...input, accountId: from.accountId, amount: sent.negated().toJSON(), status: "posted" },
          null,
        );
  if (outflow !== null && outflow !== "closed" && "issues" in outflow)
    issues.push(...renamed(outflow.issues, { accountId: "fromAccountId" }));
  if (issues.length > 0 || outflow === null) return { kind: "invalid", issues };
  if (outflow === "closed" || to.status === "closed") return { kind: "closed" };
  const debit = outflow as Checked;
  // The credit's currency: the one sent, else the account's own (a multi-currency account: the debit's if it has it,
  // else its first subaccount's).
  const creditCurrency =
    given !== null && !isIssue(given)
      ? given.currency
      : to.subaccounts.some((s) => s.currency === debit.amount.currency)
        ? debit.amount.currency
        : (to.subaccounts[0]?.currency ?? debit.amount.currency);
  const debitAmount = debit.amount.negated();
  const two = creditCurrency !== debitAmount.currency;
  const [rate, forward] = two
    ? await deps.rates([
        { from: creditCurrency, to: debitAmount.currency, date: debit.date },
        { from: debitAmount.currency, to: creditCurrency, date: debit.date },
      ])
    : [null, null];
  if (two && (rate === null || rate === undefined))
    return { kind: "invalid", issues: [{ field: "date", issue: "rate_unavailable" }] };
  const received = transferReceived(
    debitAmount,
    creditCurrency,
    given as Money | null,
    forward ?? null,
    debit.date,
  );
  if (received === "rate_unavailable")
    return { kind: "invalid", issues: [{ field: "date", issue: "rate_unavailable" }] };
  if (isIssue(received)) return { kind: "invalid", issues: [received] };
  // The journal keeps the credit converted into the debit's currency at the kept rate (fx-transfer, ARC-11): a
  // credit whose converted value is beyond a stored amount could never be posted — a field issue, nothing written.
  if (two && !creditFitsJournal(received, rate!, debit.date))
    return { kind: "invalid", issues: [{ field: given === null ? "amount" : "received", issue: "invalid" }] };
  const inflow = await check(
    deps,
    householdId,
    { ...input, accountId: to.accountId, amount: received.toJSON(), status: "posted" },
    null,
  );
  if (inflow === "closed") return { kind: "closed" };
  if ("issues" in inflow)
    return {
      kind: "invalid",
      issues: renamed(inflow.issues, {
        accountId: "toAccountId",
        amount: "received",
        "amount.currency": "received.currency",
      }),
    };
  return inTransactions(async (tx) => {
    // Row 198 (#455): both accounts' money locks, then their state as it is now — a closing or a wallet's removal may
    // have committed since the checks above; under the locks none can until these rows have.
    await tx.lockAccounts(householdId, [debit.account.accountId, inflow.account.accountId]);
    for (const side of [debit, inflow]) {
      const now = await deps.accounts.postingAccount(householdId, side.account.accountId);
      if (now?.status === "closed") return { kind: "closed" };
      if (!now?.subaccounts.some((s) => s.subaccountId === side.subaccount.subaccountId))
        return { kind: "not-found" };
    }
    const link: TransferLink = {
      id: deps.newId(),
      outflowId: deps.newId(),
      inflowId: deps.newId(),
      rate: two ? rate! : null,
    };
    // The pair first: both rows point at it from their insert (its keys to the rows are checked at the commit).
    await tx.insertTransfer(householdId, link);
    for (const [id, side] of [
      [link.outflowId, debit],
      [link.inflowId, inflow],
    ] as const)
      await tx.insert(householdId, {
        id,
        accountId: side.account.accountId,
        subaccountId: side.subaccount.subaccountId,
        amount: side.amount,
        date: side.date,
        counterparty: side.counterparty,
        description: side.description,
        status: "posted",
        source: "manual",
        hidden: false,
        split: null,
        transfer: link,
        mergedInto: null,
        note: null,
        tagIds: [],
        oneOff: false,
        // BUD-12 FR 8: a transaction entered by hand never goes into «До розбору».
        review: reviewOnCreate({ importedFromStatement: false }),
        version: 1,
      });
    // Read back with their pair, so the audit entry has the side and the other transaction (FR 20).
    const out = (await tx.find(householdId, link.outflowId))!;
    const into = (await tx.find(householdId, link.inflowId))!;
    const handOffs: TransactionHandOff[] = [];
    // The inflow first, as a mark makes them (markTransfer); here it has no own event either way (hand-off.ts).
    for (const row of [into, out]) {
      await tx.publishCreated(householdId, row.id);
      const h: TransactionHandOff = {
        transactionId: row.id,
        actorAccountId: caller.accountId,
        action: "create",
        version: row.version,
        transferId: link.id,
        audit: transactionAuditValues("create", null, row),
      };
      await tx.enqueueHandOff(householdId, h);
      handOffs.push(h);
    }
    return { kind: "ok", outflow: out, inflow: into, handOffs };
  });
}
