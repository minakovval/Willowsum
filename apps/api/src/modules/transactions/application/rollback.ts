import { transactionAuditValues, type HandOffDeps, type TransactionHandOff } from "./hand-off.ts";
import { ImportBusy, ImportWriteRefused, type ImportWriteTx } from "./imported.ts";
import type { NewStoredTransaction, StoredTransaction } from "./stored.ts";

/**
 * «Відкотити» an applied import batch (IMP-04@PoC FR 8, AC7, EC4; IMP-16@PoC FR 1–5, FR 9; wave 2 row 44). Nothing is
 * deleted: one transaction of this module for the whole batch, in the order of the apply's write (imported.ts):
 *
 * 0. a waiter's place of the space (`ImportBusy` when none is free);
 * 1. the import lock of the batch's accounts in the order of their ids — so a write of another batch on them goes
 *    before or after, never in between;
 * 2. the batch's rollback record (`import_rollbacks`): found — rolled back already (a retry or a request at the same
 *    time): nothing changes, its result comes back (FR 3);
 * 3. the batch's rows and the rows merged into them locked in one statement in the order of their ids (as «Об'єднати»
 *    and the apply lock theirs); a row merged into one of them meanwhile that is held elsewhere — `ImportRollbackBusy`;
 * 4. the accounts' money lock (accounts `lockAccounts`) and their state: closed — refused, nothing changed;
 * 5. each row of the batch: a side of a transfer is kept (IMP-16 FR 6 comes later); one the person changed after the
 *    apply (a split, a note of its own, a category set by hand — module categorization's port) is kept with «Залишити
 *    змінені» (the default, FR 4); any other is rolled back — hidden, `rolled_back_at` set, its hand-off reverses its
 *    journal event (a reversal entry, never a deletion) — and every transaction merged into it comes back
 *    («Роз'єднати»: a manual one merged on apply with its own category and note, a pending one it replaced; FR 5),
 *    after it, so the balance never counts both;
 * 6. the rollback record and the hand-off jobs (journal and audit, ARC-04 FR 2), then commit.
 */

export const ROLLBACK_MODES = ["keep-changed", "all"] as const;
export type RollbackMode = (typeof ROLLBACK_MODES)[number];

/** At most this many kept transactions are named in the result (the count names them all). */
export const ROLLBACK_KEPT_LISTED = 200;

/** At most this many recorded rollbacks are listed for module import-sessions' recovery in one run. */
export const ROLLBACK_RECOVERY_LISTED = 200;

export interface ImportRollbackInput {
  readonly batchId: string;
  readonly actorId: string;
  /** The accounts the batch's files wrote to; the accounts of its rows now are added. */
  readonly accountIds: readonly string[];
  readonly mode: RollbackMode;
}

export interface ImportRollbackCounts {
  /** Rolled back now: hidden, journal event reversed. */
  readonly rolledBack: number;
  /** Kept because the person changed them (FR 4, «Залишити змінені»). */
  readonly kept: number;
  /** Kept as sides of a transfer (IMP-16 FR 6 is a later part). */
  readonly transfers: number;
  /** Transactions merged into a rolled-back one that came back (FR 5). */
  readonly restored: number;
}

export interface ImportRollbackResult {
  /** False — rolled back before (by an earlier or a concurrent request): nothing changed now. */
  readonly first: boolean;
  /** The mode the batch was rolled back with — the first request's (a later one's mode changes nothing). */
  readonly mode: RollbackMode;
  /** Who rolled it back and when — the first request's. */
  readonly rolledBackBy: string;
  readonly rolledBackAt: Date;
  readonly counts: ImportRollbackCounts;
  /** The kept transactions (changed ones, then transfers), at most `ROLLBACK_KEPT_LISTED`. */
  readonly kept: readonly string[];
}

/** A row merged into one of the batch's meanwhile is held by another transaction: nothing changed, try again. */
export class ImportRollbackBusy extends Error {
  constructor() {
    super("A transaction of the batch is being changed");
    this.name = "ImportRollbackBusy";
  }
}

/** A transaction as the rollback locks it: rolled back ones too. */
export interface RollbackRow extends StoredTransaction {
  readonly importBatchId: string | null;
  readonly rolledBack: boolean;
}

/** The category of a transaction as module categorization keeps it (its `source`: «manual» is the person's). */
export interface RollbackCategory {
  readonly categoryId: string | null;
  readonly source: string;
}

export interface ImportRollbackTx extends Pick<
  ImportWriteTx,
  "enterImport" | "lockImport" | "lockAccounts" | "update" | "enqueueHandOff"
> {
  /** Step 2: the batch's rollback; null — none. */
  rolledBackBatch(householdId: string, batchId: string): Promise<Omit<ImportRollbackResult, "first"> | null>;
  /** The rollbacks recorded in `[since, before)`, earliest first, at most `limit`. */
  rolledBackSince(
    householdId: string,
    since: Date,
    before: Date,
    limit: number,
  ): Promise<readonly (Omit<ImportRollbackResult, "first"> & { readonly batchId: string })[]>;
  /** The ids and accounts of the batch's rows (rolled back ones too), unlocked. */
  batchRows(householdId: string, batchId: string): Promise<readonly { id: string; accountId: string }[]>;
  /** The rows merged into `ids` (their ids), unlocked. */
  mergedInto(householdId: string, ids: readonly string[]): Promise<readonly string[]>;
  /** Step 3: `ids` locked in the order of their ids; absent — no such row. */
  lockRows(householdId: string, ids: readonly string[]): Promise<readonly RollbackRow[]>;
  markRolledBack(householdId: string, id: string, at: Date): Promise<void>;
  recordRollback(
    householdId: string,
    batchId: string,
    result: Omit<ImportRollbackResult, "first">,
  ): Promise<void>;
}

export interface ImportRollbackDeps {
  readonly accounts: HandOffDeps["accounts"];
  readonly now: () => Date;
  /** Module categorization: the categories of `ids` (absent — none). */
  readonly categories: (
    householdId: string,
    ids: readonly string[],
  ) => Promise<ReadonlyMap<string, RollbackCategory>>;
}

/**
 * FR 4: the person changed the row after the apply — split it, wrote a note of its own, or set its category by hand.
 * The note and the category a manual transaction merged into it on apply brought (IMP-04 FR 5) are not a change.
 */
export function changedAfterApply(
  row: StoredTransaction,
  mergedManual: StoredTransaction | null,
  categories: ReadonlyMap<string, RollbackCategory>,
): boolean {
  if (row.split !== null) return true;
  if ((row.note ?? null) !== (mergedManual?.note ?? null)) return true;
  const category = categories.get(row.id);
  if (category?.source !== "manual") return false;
  const carried = mergedManual ? categories.get(mergedManual.id) : undefined;
  return !(carried?.source === "manual" && carried.categoryId === category.categoryId);
}

export async function rollbackImport(
  deps: ImportRollbackDeps,
  tx: ImportRollbackTx,
  householdId: string,
  input: ImportRollbackInput,
): Promise<ImportRollbackResult & { readonly handOffs: readonly TransactionHandOff[] }> {
  if (!(await tx.enterImport(householdId))) throw new ImportBusy();
  // The accounts of the batch's rows now (a row may have been moved) with those of its files.
  const unlocked = await tx.batchRows(householdId, input.batchId);
  const accountIds = [
    ...new Set([...input.accountIds, ...unlocked.map((r) => r.accountId)].map((id) => id.toLowerCase())),
  ].sort();
  await tx.lockImport(householdId, accountIds);
  const earlier = await tx.rolledBackBatch(householdId, input.batchId);
  if (earlier) return { first: false, ...earlier, handOffs: [] };

  // Step 3: the batch's rows (no write of the batch can come: it is written once, under this lock) and the rows merged
  // into them, all in the order of their ids.
  const batchIds = new Set(unlocked.map((r) => r.id.toLowerCase()));
  const merged = await tx.mergedInto(householdId, [...batchIds]);
  const locked = await tx.lockRows(householdId, [...new Set([...batchIds, ...merged])].sort());
  const byId = new Map(locked.map((r) => [r.id.toLowerCase(), r]));
  // A row merged into one of the batch's after the unlocked read: not in the order of ids — try again.
  for (const id of await tx.mergedInto(householdId, [...batchIds]))
    if (!byId.has(id.toLowerCase())) throw new ImportRollbackBusy();
  for (const r of locked)
    if (!accountIds.includes(r.accountId.toLowerCase()))
      throw new ImportWriteRefused("account-changed", { accountId: r.accountId });

  // Step 4: the money lock, then the accounts as they are under it.
  await tx.lockAccounts(householdId, accountIds);
  for (const accountId of accountIds) {
    const account = await deps.accounts.postingAccount(householdId, accountId);
    if (!account) throw new ImportWriteRefused("account-not-found", { accountId });
    if (account.status === "closed") throw new ImportWriteRefused("account-closed", { accountId });
  }

  const rows = locked.filter((r) => batchIds.has(r.id.toLowerCase()) && !r.rolledBack);
  const into = (id: string) => locked.filter((m) => m.mergedInto?.toLowerCase() === id.toLowerCase());
  const manualOf = (id: string) => into(id).find((m) => m.source === "manual") ?? null;
  const categories =
    input.mode === "all"
      ? new Map<string, RollbackCategory>()
      : await deps.categories(householdId, [
          ...rows.map((r) => r.id),
          ...rows.flatMap((r) => into(r.id).map((m) => m.id)),
        ]);

  const at = deps.now();
  const handOffs: TransactionHandOff[] = [];
  const handOff = async (
    action: TransactionHandOff["action"],
    before: StoredTransaction,
    after: StoredTransaction,
    extra: TransactionHandOff["audit"] = [],
  ) => {
    const h: TransactionHandOff = {
      transactionId: after.id,
      actorAccountId: input.actorId,
      action,
      version: after.version,
      audit: [...transactionAuditValues(action, before, after), ...extra],
    };
    await tx.enqueueHandOff(householdId, h);
    handOffs.push(h);
  };
  const keptChanged: string[] = [];
  const keptTransfers: string[] = [];
  let rolledBack = 0;
  let restored = 0;
  for (const row of rows) {
    if (row.transfer !== null) {
      keptTransfers.push(row.id);
      continue;
    }
    if (input.mode === "keep-changed" && changedAfterApply(row, manualOf(row.id), categories)) {
      keptChanged.push(row.id);
      continue;
    }
    // Rolled back: hidden, out of any merge; its hand-off (with the row out of every read) reverses its event.
    const next: NewStoredTransaction = {
      ...row,
      hidden: true,
      mergedInto: null,
      version: row.version + 1,
    };
    const after = await tx.update(householdId, next);
    await tx.markRolledBack(householdId, row.id, at);
    await handOff("rollback", row, after, [
      { field: "rolledBack", before: null, after: input.batchId, sensitive: false },
    ]);
    rolledBack += 1;
    // FR 5: what was merged into it comes back — a manual one with its own fields and event, a replaced pending one.
    for (const m of into(row.id)) {
      if (batchIds.has(m.id.toLowerCase()) || m.rolledBack) continue;
      const shown = await tx.update(householdId, {
        ...m,
        hidden: false,
        mergedInto: null,
        version: m.version + 1,
      });
      await handOff("unmerge", m, shown);
      restored += 1;
    }
  }
  const result: Omit<ImportRollbackResult, "first"> = {
    mode: input.mode,
    rolledBackBy: input.actorId,
    rolledBackAt: at,
    counts: { rolledBack, kept: keptChanged.length, transfers: keptTransfers.length, restored },
    kept: [...keptChanged, ...keptTransfers].slice(0, ROLLBACK_KEPT_LISTED),
  };
  await tx.recordRollback(householdId, input.batchId, result);
  return { first: true, ...result, handOffs };
}

/** The batch's rollback as recorded (the caller finishes its own record after a crash); null — not rolled back. */
export async function rolledBackImport(
  tx: Pick<ImportRollbackTx, "rolledBackBatch">,
  householdId: string,
  batchId: string,
): Promise<Omit<ImportRollbackResult, "first"> | null> {
  return tx.rolledBackBatch(householdId, batchId);
}
