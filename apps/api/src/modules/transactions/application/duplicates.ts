import {
  dismissalPair,
  dismissIssues,
  issuesOfRequest,
  mergeIssues,
  mergeRoles,
  type FieldIssue,
} from "../domain/index.ts";
import { transactionAuditValues, type TransactionHandOff } from "./hand-off.ts";
import type { StoredTransaction } from "./stored.ts";
import { showLonelyCopies, type Caller, type TransactionsDeps, type TransactionsTx } from "./transactions.ts";
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
 * hidden, in a transfer or merged, the duplicate not one others were merged into (domain mergeIssues). Of a manual and
 * an imported transaction the imported one stays whichever the user acted on (FR 11, FR 17, AC26; domain mergeRoles):
 * the manual one is merged into it — not a split one, whose parts would not go over — and `transactions.import-merged`
 * in the outbox gives the bank's transaction the manual one's category (module categorization). The result is the one
 * that stays.
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
    const [requested, other] = await lockBoth(tx, householdId, id, duplicateId);
    if (!requested) return { kind: "not-found" };
    // Another space's transaction and an unknown one answer the same (П-5).
    if (!other) return { kind: "invalid", issues: [{ field: "duplicateId", issue: "not_found" }] };
    const { kept, duplicate, swapped, intoBank } = mergeRoles(requested, other);
    const nested = (await tx.duplicatesOf(householdId, duplicate.id)).length > 0;
    const issues = mergeIssues(kept, duplicate, nested);
    if (intoBank && duplicate.split !== null) issues.push({ field: "duplicateId", issue: "split" });
    if (issues.length > 0) return { kind: "invalid", issues: issuesOfRequest(issues, swapped) };
    if (await anyClosed(deps, tx, householdId, [kept])) return { kind: "closed" };
    const merged = await tx.update(householdId, {
      ...duplicate,
      hidden: true,
      mergedInto: kept.id,
      version: duplicate.version + 1,
    });
    const handOffs = [await enqueue(tx, caller, "merge", duplicate, merged)];
    let stays = kept;
    if (intoBank) {
      // FR 11 «ручна транзакція зберігає … нотатки», BUD-13 FR 1 tags, BUD-06 FR 8 «Одноразова витрата»: the record that
      // stays takes them, as on an import's merge (IMP-04 FR 5); its own are kept. Texts only: no journal change.
      const tagIds = [...new Set([...kept.tagIds, ...duplicate.tagIds])];
      const note = kept.note ?? duplicate.note;
      const oneOff = kept.oneOff || duplicate.oneOff;
      if (note !== kept.note || tagIds.length !== kept.tagIds.length || oneOff !== kept.oneOff) {
        stays = await tx.update(householdId, { ...kept, note, tagIds, oneOff, version: kept.version + 1 });
        handOffs.push(await enqueue(tx, caller, "update", kept, stays));
      }
      await tx.publishImportMerged(householdId, {
        transactionId: kept.id,
        duplicateId: duplicate.id,
        actorAccountId: caller.accountId,
      });
    }
    return { kind: "ok", transaction: stays, handOffs };
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
    // The duplicates' own accounts too: the one that stays may have moved to another account since the merge.
    if (await anyClosed(deps, tx, householdId, [kept, ...duplicates])) return { kind: "closed" };
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
 * The audit entry is the transaction's the action was on (`notDuplicateOf`). FR 35 (owner, 2026-11-15, #281 item 5): a
 * side hidden as a duplicate is shown again in the same transaction when no other pair is left to it, so «Не дубль»
 * never leaves a real operation out of the balance. Under the space's lock of duplicates first, then both rows.
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
    await tx.lockDuplicates(householdId);
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
    if (await anyClosed(deps, tx, householdId, [current])) return { kind: "closed" };
    const [first, second] = dismissalPair(id, counterpartId);
    if (!(await tx.insertDismissal(householdId, first, second)))
      return { kind: "ok", transaction: current, handOffs: [] };
    const row = await tx.update(householdId, { ...current, version: current.version + 1 });
    const audit = [{ field: "notDuplicateOf", before: null, after: counterpartId, sensitive: false }];
    const dismissed = await enqueue(tx, caller, "not-duplicate", current, row, audit);
    const shown = await showLonelyCopies(deps, tx, caller, [id, counterpartId]);
    return {
      kind: "ok",
      transaction: shown.rows.get(id) ?? row,
      handOffs: [dismissed, ...shown.handOffs],
    };
  });
}
