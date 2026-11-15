import { dismissalPair, dismissIssues, mergeIssues, type FieldIssue } from "../domain/index.ts";
import { transactionAuditValues, type TransactionHandOff } from "./hand-off.ts";
import type { StoredTransaction } from "./stored.ts";
import type { Caller, TransactionsDeps, TransactionsTx } from "./transactions.ts";
import { anyClosed, lockBoth, type InTransactions } from "./transfers.ts";

/**
 * Duplicates (FIN-03@PoC FR 11, FR 12, FR 27, edge case 4; wave 2 row 16c): «Об'єднати» of a «Можливий дубль» and
 * «Об'єднати з іншою» merge a duplicate into the transaction that stays; «Роз'єднати» gives it back; «Не дубль» keeps
 * the pair out of «Можливий дубль» for good. Only the duplicate's row changes (the one that stays keeps every field),
 * under the lock of both rows in the order of their ids, with its hand-off (ARC-04): merged, its own journal event is
 * reversed (hand-off.ts), so the operation counts once; unmerged, it is posted again. Never automatic (FR 12).
 */

export type DuplicateResult =
  | {
      readonly kind: "ok";
      /** The transaction the action was on, as it is now. */
      readonly transaction: StoredTransaction;
      /** Run them in order once the transaction has committed; the worker runs them too. Empty: nothing changed. */
      readonly handOffs: readonly TransactionHandOff[];
    }
  | { readonly kind: "invalid"; readonly issues: readonly FieldIssue[] }
  | { readonly kind: "closed" }
  | { readonly kind: "not-found" };

async function enqueue(
  tx: TransactionsTx,
  caller: Caller,
  action: TransactionHandOff["action"],
  before: StoredTransaction,
  after: StoredTransaction,
  audit = transactionAuditValues(action, before, after),
): Promise<TransactionHandOff> {
  const handOff: TransactionHandOff = {
    transactionId: after.id,
    actorAccountId: caller.accountId,
    action,
    version: after.version,
    audit,
  };
  await tx.enqueueHandOff(caller.householdId, handOff);
  return handOff;
}

/**
 * «Об'єднати»: `duplicateId` merged into `id`, which stays — on one account with the same amount and currency, neither
 * hidden, in a transfer or merged, the duplicate not one others were merged into (domain mergeIssues).
 */
export async function mergeDuplicate(
  deps: TransactionsDeps,
  inTransactions: InTransactions,
  caller: Caller,
  id: string,
  duplicateId: string,
): Promise<DuplicateResult> {
  const householdId = caller.householdId;
  return inTransactions(async (tx) => {
    const [kept, duplicate] = await lockBoth(tx, householdId, id, duplicateId);
    if (!kept) return { kind: "not-found" };
    // Another space's transaction and an unknown one answer the same (П-5).
    if (!duplicate) return { kind: "invalid", issues: [{ field: "duplicateId", issue: "not_found" }] };
    const nested = (await tx.duplicatesOf(householdId, duplicateId)).length > 0;
    const issues = mergeIssues(kept, duplicate, nested);
    if (issues.length > 0) return { kind: "invalid", issues };
    if (await anyClosed(deps, householdId, [kept])) return { kind: "closed" };
    const merged = await tx.update(householdId, {
      ...duplicate,
      hidden: true,
      mergedInto: kept.id,
      version: duplicate.version + 1,
    });
    return {
      kind: "ok",
      transaction: kept,
      handOffs: [await enqueue(tx, caller, "merge", duplicate, merged)],
    };
  });
}

/**
 * «Роз'єднати» (edge case 4): on a merged duplicate it comes back alone; on the transaction that stays every duplicate
 * merged into it comes back. Each is shown again with its own fields and journal event; nothing merged — nothing changes.
 */
export async function unmergeDuplicate(
  deps: TransactionsDeps,
  inTransactions: InTransactions,
  caller: Caller,
  id: string,
): Promise<DuplicateResult> {
  const householdId = caller.householdId;
  return inTransactions(async (tx) => {
    const seen = await tx.find(householdId, id);
    if (!seen) return { kind: "not-found" };
    const keptId = seen.mergedInto ?? id;
    const named = seen.mergedInto !== null ? [id] : await tx.duplicatesOf(householdId, id);
    if (named.length === 0) return { kind: "ok", transaction: seen, handOffs: [] };
    // Every row locked in the order of the ids, as a merge locks its two.
    const locked = new Map<string, StoredTransaction>();
    for (const rowId of [...new Set([keptId, ...named])].sort()) {
      const row = await tx.lock(householdId, rowId);
      if (row) locked.set(rowId, row);
    }
    const kept = locked.get(keptId);
    const duplicates = named
      .map((d) => locked.get(d))
      .filter((d): d is StoredTransaction => d?.mergedInto === keptId);
    if (!kept || duplicates.length === 0) {
      const now = locked.get(id) ?? (await tx.find(householdId, id));
      return now ? { kind: "ok", transaction: now, handOffs: [] } : { kind: "not-found" };
    }
    if (await anyClosed(deps, householdId, [kept])) return { kind: "closed" };
    const handOffs: TransactionHandOff[] = [];
    let result = kept;
    for (const duplicate of duplicates) {
      const row = await tx.update(householdId, {
        ...duplicate,
        hidden: false,
        mergedInto: null,
        version: duplicate.version + 1,
      });
      handOffs.push(await enqueue(tx, caller, "unmerge", duplicate, row));
      if (row.id === id) result = row;
    }
    return { kind: "ok", transaction: result, handOffs };
  });
}

/**
 * «Не дубль» (FR 12): the mark is taken off the pair and never put on it again. The pair must be one that could be a
 * duplicate (one account, the same amount and currency; domain dismissIssues), neither merged. Twice: nothing changes.
 * The audit entry is the transaction's the action was on (`notDuplicateOf`).
 */
export async function dismissDuplicate(
  deps: TransactionsDeps,
  inTransactions: InTransactions,
  caller: Caller,
  id: string,
  counterpartId: string,
): Promise<DuplicateResult> {
  const householdId = caller.householdId;
  return inTransactions(async (tx) => {
    const [current, counterpart] = await lockBoth(tx, householdId, id, counterpartId);
    if (!current) return { kind: "not-found" };
    if (!counterpart) return { kind: "invalid", issues: [{ field: "counterpartId", issue: "not_found" }] };
    const issues = dismissIssues(current, counterpart);
    for (const [field, side] of [
      ["transactionId", current],
      ["counterpartId", counterpart],
    ] as const)
      if (side.mergedInto !== null) issues.push({ field, issue: "merged" });
    if (issues.length > 0) return { kind: "invalid", issues };
    if (await anyClosed(deps, householdId, [current])) return { kind: "closed" };
    const [first, second] = dismissalPair(id, counterpartId);
    if (!(await tx.insertDismissal(householdId, first, second)))
      return { kind: "ok", transaction: current, handOffs: [] };
    const row = await tx.update(householdId, { ...current, version: current.version + 1 });
    const audit = [{ field: "notDuplicateOf", before: null, after: counterpartId, sensitive: false }];
    return {
      kind: "ok",
      transaction: row,
      handOffs: [await enqueue(tx, caller, "not-duplicate", current, row, audit)],
    };
  });
}
