import type { ExchangeRate } from "@willowsum/domain-kernel";
import { orderPair, transferRateRequest, type FieldIssue, type TransferLink } from "../domain/index.ts";
import { transactionAuditValues, type TransactionHandOff } from "./hand-off.ts";
import type { Caller, TransactionsDeps, TransactionsTx } from "./transactions.ts";
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
async function lockBoth(
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

async function anyClosed(deps: TransactionsDeps, householdId: string, rows: readonly StoredTransaction[]) {
  for (const row of rows) {
    const account = await deps.accounts.postingAccount(householdId, row.accountId);
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
    if (await anyClosed(deps, householdId, [pair.outflow, pair.inflow])) return { kind: "closed" };
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
    if (await anyClosed(deps, householdId, [current, counterpart])) return { kind: "closed" };
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
