import { decidedOneSided, flaggedOneSided, oneSidedIssues, type FieldIssue } from "../domain/index.ts";
import { transactionAuditValues, type TransactionHandOff } from "./hand-off.ts";
import type { Caller, TransactionsDeps, TransactionsTx } from "./transactions.ts";
import { anyClosed, type InTransactions, type TransferResult } from "./transfers.ts";
import type { StoredTransaction } from "./stored.ts";

/**
 * IMP-03@PoC FR 14, FR 15, FR 22 — the one-sided transfer (domain/one-sided.ts). «Це переказ» and «Це не переказ» are
 * the user's (`decideOneSided`); the flag is the system's (`flagOneSided`, run by module transfer-matching after new
 * transactions arrive and on «Шукати пари знову»). Each change is the row's: its version, its hand-off and its audit
 * entry (`oneSidedTransfer`, FR 19); the journal does not change — the money still left or reached the account, only the
 * budget's view of it changes (FR 22).
 */

async function writeOneSided(
  tx: TransactionsTx,
  actorAccountId: string,
  householdId: string,
  current: StoredTransaction,
  next: StoredTransaction["oneSided"],
): Promise<{ row: StoredTransaction; handOff: TransactionHandOff }> {
  const row = await tx.update(householdId, { ...current, oneSided: next, version: current.version + 1 });
  const handOff: TransactionHandOff = {
    transactionId: row.id,
    actorAccountId,
    action: "one-sided",
    version: row.version,
    audit: transactionAuditValues("one-sided", current, row),
  };
  await tx.enqueueHandOff(householdId, handOff);
  return { row, handOff };
}

/**
 * «Це переказ» (`isTransfer` true: neither income nor expense, FR 22) or «Це не переказ» (false: the flag is gone and
 * never set again, FR 14) on `id` — flagged or not (FR 24: with no candidates the user marks it a one-sided transfer). A
 * transaction of the space, posted, shown, not split, not merged, in no transfer, not zero (400 with the codes of
 * «Позначити як переказ»); its account active (409 `ACCOUNT_CLOSED`). The same decision again — nothing changes.
 */
export async function decideOneSided(
  deps: TransactionsDeps,
  inTransactions: InTransactions,
  caller: Caller,
  id: string,
  isTransfer: boolean,
): Promise<TransferResult> {
  const householdId = caller.householdId;
  return inTransactions(async (tx) => {
    const current = await tx.lock(householdId, id);
    if (!current) return { kind: "not-found" };
    const issues = oneSidedIssues(current);
    if (issues.length > 0)
      return {
        kind: "invalid",
        issues: issues.map((issue): FieldIssue => ({ field: "transactionId", issue })),
      };
    const next = decidedOneSided(current.oneSided, isTransfer);
    if (current.oneSided?.state === next.state) return { kind: "ok", transaction: current, handOffs: [] };
    if (await anyClosed(deps, tx, householdId, [current])) return { kind: "closed" };
    const { row, handOff } = await writeOneSided(tx, caller.accountId, householdId, current, next);
    return { kind: "ok", transaction: row, handOffs: [handOff] };
  });
}

/**
 * The system's flag «односторонній переказ» on each of `items` (FR 14, FR 15) that is still free (posted, shown, not
 * split, not merged, in no transfer) and never had a state — a dismissed one never again; the others are skipped. Each
 * in its own transactions transaction, so one refusal never undoes the others. The audit entry is `actorAccountId`'s
 * (the user whose import or search ran it). The flagged ids, with the hand-offs to run once committed.
 */
export async function flagOneSided(
  inTransactions: InTransactions,
  caller: Caller,
  items: readonly { readonly transactionId: string; readonly evidence: readonly string[] }[],
): Promise<{ flagged: string[]; handOffs: TransactionHandOff[] }> {
  const householdId = caller.householdId;
  const flagged: string[] = [];
  const handOffs: TransactionHandOff[] = [];
  for (const item of items) {
    const done = await inTransactions(async (tx) => {
      const current = await tx.lock(householdId, item.transactionId);
      if (!current || oneSidedIssues(current).length > 0) return null;
      const next = flaggedOneSided(current.oneSided, item.evidence);
      if (next === null) return null;
      return writeOneSided(tx, caller.accountId, householdId, current, next);
    });
    if (done) {
      flagged.push(done.row.id);
      handOffs.push(done.handOff);
    }
  }
  return { flagged, handOffs };
}
